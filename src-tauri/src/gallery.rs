use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::models::{AppState, CropRecord, ImageEntry};
use crate::paths::{
    canonical_source_dir, detect_nsfw, is_hidden_or_excluded_dir, is_image_file, path_string,
    relative_path_for_record, validate_source_path,
};
use crate::records::{read_crops, read_skipped, write_crops, write_skipped};

fn move_to_deleted(src: &Path, source_dir: &Path) -> Result<(), String> {
    let rel = src
        .strip_prefix(source_dir)
        .map_err(|_| "无法计算相对路径")?;
    let filename = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    let dst_dir = source_dir
        .join("_deleted")
        .join(rel.parent().unwrap_or(Path::new("")));
    fs::create_dir_all(&dst_dir).map_err(|e| format!("创建回收目录失败: {}", e))?;

    let mut dst = dst_dir.join(filename);
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let mut seq = 1;
    while dst.exists() {
        let new_name = if ext.is_empty() {
            format!("{}-{}", stem, seq)
        } else {
            format!("{}-{}.{}", stem, seq, ext)
        };
        dst = dst_dir.join(new_name);
        seq += 1;
    }

    match fs::rename(src, &dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, &dst).map_err(|e| format!("复制文件失败: {}", e))?;
            fs::remove_file(src).map_err(|e| format!("删除源文件失败: {}", e))?;
            Ok(())
        }
    }
}

#[tauri::command]
pub(crate) async fn scan_images(
    state: tauri::State<'_, AppState>,
    include_nsfw: bool,
) -> Result<Vec<ImageEntry>, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    let root = canonical_source_dir(&source_dir)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        for result in WalkDir::new(&root).into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                !is_hidden_or_excluded_dir(&name)
            } else {
                true
            }
        }) {
            let entry = match result {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if !is_image_file(path) {
                continue;
            }
            let is_nsfw = detect_nsfw(path, &root);
            if !include_nsfw && is_nsfw {
                continue;
            }
            let relative_path =
                relative_path_for_record(path.strip_prefix(&root).map_err(|_| "相对路径计算失败")?);
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            entries.push(ImageEntry {
                source_path: path_string(path),
                relative_path,
                filename,
                is_nsfw,
            });
        }

        entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(entries)
    })
    .await
    .map_err(|e| format!("扫描目录任务失败: {}", e))?
}

#[tauri::command]
pub(crate) fn delete_original_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<(), String> {
    let (source_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), state.records_lock.clone())
    };

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;

    let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;

    let mut records = read_crops(&source_dir)?;
    let before = records.len();
    let canon_str = path_string(&canon);
    let canon_raw = canon.to_string_lossy().to_string();
    records.retain(|r| {
        r.source_path != source_path && r.source_path != canon_str && r.source_path != canon_raw
    });
    let crops_changed = records.len() != before;

    // 准备清理 skipped.json，等 move 成功后再写回
    let mut skipped = read_skipped(&source_dir)?;
    let skipped_before = skipped.len();
    skipped.retain(|r| {
        r.source_path != source_path && r.source_path != canon_str && r.source_path != canon_raw
    });
    let skipped_changed = skipped.len() != skipped_before;

    move_to_deleted(&canon, &root)?;

    if skipped_changed {
        write_skipped(&source_dir, &skipped)?;
    }
    if crops_changed {
        write_crops(&source_dir, &records)?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn resolve_original_for_record(
    state: tauri::State<'_, AppState>,
    record: CropRecord,
) -> Result<ImageEntry, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    let root = canonical_source_dir(&source_dir)?;

    // 优先用 source_dir + relative_path
    let candidate = root.join(&record.relative_path);
    if candidate.exists() {
        let canon = validate_source_path(&source_dir, &candidate.to_string_lossy())?;
        let rel = relative_path_for_record(canon.strip_prefix(&root).unwrap_or(Path::new("")));
        let filename = canon
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let is_nsfw = detect_nsfw(&canon, &root);
        return Ok(ImageEntry {
            source_path: path_string(&canon),
            relative_path: rel,
            filename,
            is_nsfw,
        });
    }

    // fallback source_path
    let fallback = PathBuf::from(&record.source_path);
    if fallback.exists() {
        let canon = validate_source_path(&source_dir, &record.source_path)?;
        let rel = relative_path_for_record(canon.strip_prefix(&root).unwrap_or(Path::new("")));
        let filename = canon
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let is_nsfw = detect_nsfw(&canon, &root);
        return Ok(ImageEntry {
            source_path: path_string(&canon),
            relative_path: rel,
            filename,
            is_nsfw,
        });
    }

    Err("原图不存在，请确认图库目录正确".into())
}
