use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use crate::crops::create_crop_file;
use crate::models::{AppState, BatchFailure, BatchProgress, BatchResult, CropRecord};
use crate::paths::{path_string, validate_output_dir, validate_source_path};
use crate::records::{read_crops, read_skipped, write_crops, write_skipped};

#[tauri::command]
pub(crate) async fn pick_json_file(handle: AppHandle) -> Result<Option<String>, String> {
    let file = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.and_then(|p| p.into_path().ok().map(|p| path_string(&p))))
}

fn run_batch_from_json_blocking(
    source_dir: &str,
    output_dir: &str,
    json_path: &str,
    handle: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
    records_lock: &std::sync::Mutex<()>,
) -> Result<BatchResult, String> {
    let text = fs::read_to_string(json_path).map_err(|e| format!("读取 JSON 失败: {}", e))?;
    let records: Vec<CropRecord> =
        serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败: {}", e))?;
    if records.len() > 10000 {
        return Err("批量导入记录数超过 10000 条上限".into());
    }

    let total = records.len();
    let mut success = 0usize;
    let mut failures = Vec::new();
    let mut new_records: Vec<CropRecord> = Vec::new();
    let mut successful_relative_paths: HashSet<String> = HashSet::new();

    let _ = handle.emit(
        format!("batch-progress-{}", job_id).as_str(),
        BatchProgress {
            total,
            done: 0,
            success: 0,
            failed: 0,
            current: "".to_string(),
        },
    );

    let mut done = 0usize;
    for record in records.into_iter() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let current_path = record.relative_path.clone();

        let candidate = Path::new(source_dir).join(&record.relative_path);
        let source_path_str = if candidate.exists() {
            path_string(&candidate)
        } else {
            record.source_path.clone()
        };

        let source = match validate_source_path(source_dir, &source_path_str) {
            Ok(p) => p,
            Err(e) => {
                failures.push(BatchFailure {
                    source_path: record.source_path,
                    reason: e,
                });
                done += 1;
                let _ = handle.emit(
                    format!("batch-progress-{}", job_id).as_str(),
                    BatchProgress {
                        total,
                        done,
                        success,
                        failed: failures.len(),
                        current: current_path,
                    },
                );
                continue;
            }
        };

        match create_crop_file(
            &source,
            source_dir,
            output_dir,
            &record.crop_name,
            record.x,
            record.y,
            record.width,
            record.height,
            &record.ratio_mode,
            &record.output_mode,
        ) {
            Ok(mut new_record) => {
                new_record.rating = record.rating.min(3);
                success += 1;
                successful_relative_paths.insert(new_record.relative_path.clone());
                new_records.push(new_record);
            }
            Err(e) => failures.push(BatchFailure {
                source_path: record.source_path,
                reason: e,
            }),
        }
        done += 1;
        let _ = handle.emit(
            format!("batch-progress-{}", job_id).as_str(),
            BatchProgress {
                total,
                done,
                success,
                failed: failures.len(),
                current: current_path,
            },
        );
    }

    // 锁内：重新读取现有记录，追加新记录，并清理 skipped
    {
        let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;
        let mut current_records = read_crops(source_dir)?;
        for r in &new_records {
            current_records.push(r.clone());
        }
        if let Err(e) = write_crops(source_dir, &current_records) {
            drop(_guard);
            for r in &new_records {
                if let Err(del_e) = fs::remove_file(&r.output_path) {
                    eprintln!(
                        "批量导入写 JSON 失败后清理孤儿裁剪图失败: {} - {}",
                        r.output_path, del_e
                    );
                }
            }
            return Err(e);
        }

        if !successful_relative_paths.is_empty() {
            let mut skipped = read_skipped(source_dir)?;
            let skipped_before = skipped.len();
            skipped.retain(|r| !successful_relative_paths.contains(&r.relative_path));
            if skipped.len() != skipped_before {
                if let Err(e) = write_skipped(source_dir, &skipped) {
                    eprintln!("批量裁剪成功，但清除跳过记录失败: {}", e);
                }
            }
        }
    }

    let cancelled = cancel_flag.load(Ordering::Relaxed);
    let final_progress = BatchProgress {
        total,
        done,
        success,
        failed: failures.len(),
        current: if cancelled {
            "已取消".to_string()
        } else {
            "".to_string()
        },
    };
    let _ = handle.emit(
        format!("batch-progress-{}", job_id).as_str(),
        final_progress,
    );

    Ok(BatchResult {
        success,
        failed: failures.len(),
        failures,
        cancelled,
        total,
        done,
    })
}

#[tauri::command]
pub(crate) async fn run_batch_from_json(
    handle: AppHandle,
    state: tauri::State<'_, AppState>,
    json_path: String,
    output_dir: String,
    job_id: String,
) -> Result<BatchResult, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    let json_meta = fs::metadata(&json_path).map_err(|e| format!("无法访问 JSON 文件: {}", e))?;
    if json_meta.len() > 50 * 1024 * 1024 {
        return Err("JSON 文件超过 50MB 上限".into());
    }
    if !json_meta.is_file() || !json_path.to_lowercase().ends_with(".json") {
        return Err("请选择有效的 JSON 文件".into());
    }

    let output_dir = path_string(&validate_output_dir(&output_dir, &source_dir)?);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state
            .cancel_flags
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        flags.insert(job_id.clone(), cancel_flag.clone());
    }

    let source_dir_clone = source_dir.clone();
    let output_dir_clone = output_dir.clone();
    let json_path_clone = json_path.clone();
    let handle_clone = handle.clone();
    let job_id_clone = job_id.clone();
    let cancel_flag_clone = cancel_flag.clone();
    let records_lock = state.records_lock.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_batch_from_json_blocking(
            &source_dir_clone,
            &output_dir_clone,
            &json_path_clone,
            &handle_clone,
            &job_id_clone,
            &cancel_flag_clone,
            &records_lock,
        )
    })
    .await
    .map_err(|e| format!("批量任务线程失败: {}", e))
    .and_then(|r| r);

    {
        let mut flags = state
            .cancel_flags
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        flags.remove(&job_id);
    }

    result
}

#[tauri::command]
pub(crate) fn cancel_batch(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let flags = state
        .cancel_flags
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    if let Some(flag) = flags.get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
