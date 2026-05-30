use base64::Engine;
use chrono::{Local, TimeZone};
use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;

use crate::models::{
    AppState, CropPreview, CropRecord, SaveCropRequest, SaveRecropRequest, SaveRecropResult,
    SkipRecord,
};
use crate::paths::{
    canonical_source_dir, is_image_file, path_string, relative_path_for_record, sanitize_filename,
    suggested_output_dir, validate_source_path,
};
use crate::records::{read_crops, read_skipped, write_crops, write_skipped};
use crate::thumbnails::generate_crop_thumbnail;

fn generate_output_filename(
    stem: &str,
    ext: &str,
    output_dir: &Path,
    relative_dir: &Path,
) -> String {
    let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let base = format!("{}__crop_{}", stem, ts);
    let mut name = format!("{}.{}", base, ext);
    let actual_dir = output_dir.join(relative_dir);
    let mut seq = 1;
    while actual_dir.join(&name).exists() {
        name = format!("{}-{}.{}", base, seq, ext);
        seq += 1;
    }
    name
}

pub(crate) fn create_crop_file(
    source_path: &Path,
    source_dir: &str,
    output_dir: &str,
    crop_name: &str,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    ratio_mode: &str,
    output_mode: &str,
) -> Result<CropRecord, String> {
    let root = canonical_source_dir(source_dir)?;
    let rel = source_path
        .strip_prefix(&root)
        .map_err(|_| "无法计算相对路径")?;

    let img = image::open(source_path).map_err(|e| format!("打开图片失败: {}", e))?;
    let (img_w, img_h) = (img.width(), img.height());

    let x = x.min(img_w.saturating_sub(1));
    let y = y.min(img_h.saturating_sub(1));
    let width = width.min(img_w - x);
    let height = height.min(img_h - y);

    if width == 0 || height == 0 {
        return Err("裁剪区域为空".into());
    }

    let stem = sanitize_filename(
        source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("crop"),
    );
    let ext = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let out_ext = if ext == "jpeg" { "jpg" } else { ext.as_str() };

    let out_dir = Path::new(output_dir).join(rel.parent().unwrap_or(Path::new("")));
    fs::create_dir_all(&out_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let out_filename = generate_output_filename(
        &stem,
        out_ext,
        Path::new(output_dir),
        rel.parent().unwrap_or(Path::new("")),
    );
    let out_path = out_dir.join(&out_filename);

    if output_mode == "mask" {
        let mut rgba = img.to_rgba8();
        for (px, py, pixel) in rgba.enumerate_pixels_mut() {
            if px < x || px >= x + width || py < y || py >= y + height {
                *pixel = image::Rgba([0, 0, 0, 255]);
            }
        }
        image::DynamicImage::ImageRgba8(rgba)
            .to_rgb8()
            .save(&out_path)
            .map_err(|e| format!("保存遮罩图失败: {}", e))?;
    } else {
        let cropped = img.crop_imm(x, y, width, height);
        cropped
            .save(&out_path)
            .map_err(|e| format!("保存裁剪图失败: {}", e))?;
    }

    let out_path_str = path_string(&out_path);
    let rel_str = relative_path_for_record(rel);

    Ok(CropRecord {
        source_path: path_string(source_path),
        relative_path: rel_str,
        crop_name: crop_name.to_string(),
        x,
        y,
        width,
        height,
        original_width: img_w,
        original_height: img_h,
        output_path: out_path_str,
        output_filename: out_filename,
        ratio_mode: ratio_mode.to_string(),
        created_at: Local::now().to_rfc3339(),
        output_mode: output_mode.to_string(),
        rating: 0,
    })
}

fn save_crop_blocking(
    source_dir: &str,
    output_dir: &str,
    request: &SaveCropRequest,
    records_lock: &std::sync::Mutex<()>,
) -> Result<CropRecord, String> {
    let canon = validate_source_path(source_dir, &request.source_path)?;
    let mut record = create_crop_file(
        &canon,
        source_dir,
        output_dir,
        &request.crop_name,
        request.x,
        request.y,
        request.width,
        request.height,
        &request.ratio_mode,
        &request.output_mode,
    )?;
    record.rating = request.rating.min(3);

    let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;

    let mut records = read_crops(source_dir)?;
    records.push(record.clone());
    write_crops(source_dir, &records)?;

    // 清除对应的跳过记录
    let mut skipped = read_skipped(source_dir)?;
    let before = skipped.len();
    let canon_str = path_string(&canon);
    let canon_raw = canon.to_string_lossy().to_string();
    skipped.retain(|r| {
        r.source_path != request.source_path
            && r.source_path != canon_str
            && r.source_path != canon_raw
    });
    if skipped.len() != before {
        if let Err(e) = write_skipped(source_dir, &skipped) {
            eprintln!("保存裁剪成功，但清除跳过记录失败: {}", e);
        }
    }

    Ok(record)
}

#[tauri::command]
pub(crate) async fn save_crop(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: SaveCropRequest,
) -> Result<CropRecord, String> {
    let (source_dir, output_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (
            settings.source_dir.clone(),
            settings.output_dir.clone(),
            state.records_lock.clone(),
        )
    };

    let source_dir_clone = source_dir.clone();
    let output_dir_clone = output_dir.clone();
    let request_clone = request;
    let record = tauri::async_runtime::spawn_blocking(move || {
        save_crop_blocking(&source_dir_clone, &output_dir_clone, &request_clone, &records_lock)
    })
    .await
    .map_err(|e| format!("保存裁剪任务失败: {}", e))
    .and_then(|r| r)?;

    let thumb_handle = handle.clone();
    let thumb_path = record.output_path.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = generate_crop_thumbnail(&thumb_handle, &thumb_path).await {
            eprintln!("保存裁剪成功，但生成缩略图失败: {}", e);
        }
    });

    Ok(record)
}

#[tauri::command]
pub(crate) fn delete_crop_record(
    state: tauri::State<'_, AppState>,
    output_path: String,
) -> Result<CropRecord, String> {
    let (source_dir, output_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (
            settings.source_dir.clone(),
            settings.output_dir.clone(),
            state.records_lock.clone(),
        )
    };

    let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;

    // 1. 读 crops.json，先确认记录存在
    let mut records = read_crops(&source_dir)?;

    let target_canon = fs::canonicalize(&output_path).ok();
    let found_idx = records.iter().position(|r| {
        if r.output_path == output_path {
            return true;
        }
        if let (Some(target), Ok(record_canon)) = (&target_canon, fs::canonicalize(&r.output_path))
        {
            return record_canon == *target;
        }
        false
    });

    let removed = match found_idx {
        Some(idx) => records.remove(idx),
        None => return Err("未找到对应裁剪记录".into()),
    };

    // 2. 确定输出目录根
    let output_root = if output_dir.is_empty() {
        let source_root = canonical_source_dir(&source_dir)?;
        suggested_output_dir(&source_root)?
    } else {
        fs::canonicalize(&output_dir).map_err(|e| format!("输出目录无效: {}", e))?
    };

    // 3. 若文件仍存在，先验证其在输出目录内（路径安全必须在写 JSON 前完成）
    if let Some(ref target) = target_canon {
        if !target.starts_with(&output_root) {
            return Err("裁剪图不在输出目录内".into());
        }
    }

    // 4. 先写回 crops.json，再删物理文件
    //    这样即使删文件失败，也只是磁盘上残留孤儿裁剪图，不会产生幽灵记录
    write_crops(&source_dir, &records)?;

    if let Some(ref target) = target_canon {
        if target.exists() {
            if let Err(e) = fs::remove_file(target) {
                return Err(format!("删除裁剪图失败: {}", e));
            }
        }
    }

    Ok(removed)
}

#[tauri::command]
pub(crate) fn resolve_cropped_image_path(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    output_path: String,
) -> Result<String, String> {
    let (source_dir, output_dir) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), settings.output_dir.clone())
    };

    let records = read_crops(&source_dir)?;

    // 只用字符串精确匹配，避免 NAS 上 N 次系统调用
    if !records.iter().any(|r| r.output_path == output_path) {
        return Err("裁剪图不在记录中".into());
    }

    let path = fs::canonicalize(&output_path).map_err(|e| format!("裁剪图不存在: {}", e))?;

    // 验证裁剪图位于输出目录内
    let output_root = if output_dir.is_empty() {
        let source_root = canonical_source_dir(&source_dir)?;
        suggested_output_dir(&source_root)?
    } else {
        fs::canonicalize(&output_dir).map_err(|e| format!("输出目录无效: {}", e))?
    };
    if !path.starts_with(&output_root) {
        return Err("裁剪图不在输出目录内".into());
    }

    if !is_image_file(&path) {
        return Err("不是支持的图片文件".into());
    }

    handle
        .asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| format!("放行文件失败: {}", e))?;
    Ok(path_string(&path))
}

#[tauri::command]
pub(crate) async fn preview_crop(
    state: tauri::State<'_, AppState>,
    request: SaveCropRequest,
) -> Result<CropPreview, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let canon = validate_source_path(&source_dir, &request.source_path)?;
        let img = image::open(&canon).map_err(|e| format!("打开图片失败: {}", e))?;
        let (img_w, img_h) = (img.width(), img.height());

        let x = request.x.min(img_w.saturating_sub(1));
        let y = request.y.min(img_h.saturating_sub(1));
        let width = request.width.min(img_w - x);
        let height = request.height.min(img_h - y);

        if width == 0 || height == 0 {
            return Err("裁剪区域为空".into());
        }

        let (preview_w, preview_h, rgb) = if request.output_mode == "mask" {
            let mut rgba = img.to_rgba8();
            for (px, py, pixel) in rgba.enumerate_pixels_mut() {
                if px < x || px >= x + width || py < y || py >= y + height {
                    *pixel = image::Rgba([0, 0, 0, 255]);
                }
            }
            (
                img_w,
                img_h,
                image::DynamicImage::ImageRgba8(rgba).to_rgb8(),
            )
        } else {
            let cropped = img.crop_imm(x, y, width, height);
            (width, height, cropped.to_rgb8())
        };

        let mut buffer: Vec<u8> = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
        encoder
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| format!("编码预览图失败: {}", e))?;

        let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
        let data_url = format!("data:image/jpeg;base64,{}", b64);

        Ok(CropPreview {
            data_url,
            width: preview_w,
            height: preview_h,
        })
    })
    .await
    .map_err(|e| format!("预览裁剪任务失败: {}", e))
    .and_then(|r| r)
}

fn save_recrop_blocking(
    source_dir: &str,
    output_dir: &str,
    request: &SaveRecropRequest,
    records_lock: &std::sync::Mutex<()>,
) -> Result<SaveRecropResult, String> {
    // 第一段锁：读取现有记录并定位旧记录索引
    let (idx, old_output_path) = {
        let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;
        let records = read_crops(source_dir)?;
        let idx = records
            .iter()
            .position(|r| r.output_path == request.old_output_path)
            .ok_or_else(|| "未找到旧裁剪记录".to_string())?;
        (idx, records[idx].output_path.clone())
    };

    // 锁外：创建新裁剪文件（图片处理，可能耗时，不应阻塞其他记录操作）
    let canon = validate_source_path(source_dir, &request.crop.source_path)?;
    let mut record = create_crop_file(
        &canon,
        source_dir,
        output_dir,
        &request.crop.crop_name,
        request.crop.x,
        request.crop.y,
        request.crop.width,
        request.crop.height,
        &request.crop.ratio_mode,
        &request.crop.output_mode,
    )?;
    record.rating = request.crop.rating.min(3);

    // 第二段锁：重新读取、验证索引未变、替换、写回
    {
        let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;
        let mut records = read_crops(source_dir)?;
        if idx >= records.len() || records[idx].output_path != old_output_path {
            // 并发修改导致索引失效，清理新文件并返回错误
            let _ = fs::remove_file(&record.output_path);
            return Err("记录已被并发修改，请重试".into());
        }
        records[idx] = record.clone();

        if let Err(e) = write_crops(source_dir, &records) {
            drop(_guard);
            if let Err(del_e) = fs::remove_file(&record.output_path) {
                eprintln!("写入 crops.json 失败后清理新裁剪图失败: {}", del_e);
            }
            return Err(e);
        }
    }

    // 锁外：删除旧物理文件
    let mut warning: Option<String> = None;
    let old_path = fs::canonicalize(&request.old_output_path).ok();
    let output_root = fs::canonicalize(output_dir).map_err(|e| format!("输出目录无效: {}", e))?;

    if let Some(old_path) = old_path {
        let new_path = fs::canonicalize(&record.output_path).ok();
        if old_path.starts_with(&output_root) && Some(old_path.as_path()) != new_path.as_deref() {
            if let Err(e) = fs::remove_file(&old_path) {
                warning = Some(format!("重裁已保存，但旧裁剪图删除失败：{}", e));
            }
        }
    }

    Ok(SaveRecropResult { record, warning })
}

#[tauri::command]
pub(crate) async fn save_recrop(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: SaveRecropRequest,
) -> Result<SaveRecropResult, String> {
    let (source_dir, output_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (
            settings.source_dir.clone(),
            settings.output_dir.clone(),
            state.records_lock.clone(),
        )
    };

    let source_dir_clone = source_dir.clone();
    let output_dir_clone = output_dir.clone();
    let request_clone = request;
    let result = tauri::async_runtime::spawn_blocking(move || {
        save_recrop_blocking(&source_dir_clone, &output_dir_clone, &request_clone, &records_lock)
    })
    .await
    .map_err(|e| format!("重裁保存任务失败: {}", e))
    .and_then(|r| r)?;

    let thumb_handle = handle.clone();
    let thumb_path = result.record.output_path.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = generate_crop_thumbnail(&thumb_handle, &thumb_path).await {
            eprintln!("重裁保存成功，但生成缩略图失败: {}", e);
        }
    });

    Ok(result)
}

#[tauri::command]
pub(crate) fn skip_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<SkipRecord, String> {
    let (source_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), state.records_lock.clone())
    };

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;
    let rel = relative_path_for_record(canon.strip_prefix(&root).map_err(|_| "无法计算相对路径")?);
    let filename = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;

    let mut records = read_skipped(&source_dir)?;
    let canon_str = path_string(&canon);
    records.retain(|r| r.source_path != source_path && r.source_path != canon_str);
    let record = SkipRecord {
        source_path: canon_str,
        relative_path: rel,
        filename,
        skipped_at: Local::now().to_rfc3339(),
    };
    records.push(record.clone());
    write_skipped(&source_dir, &records)?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn unskip_image(
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

    let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;

    let mut records = read_skipped(&source_dir)?;
    let before = records.len();
    let canon = fs::canonicalize(&source_path).ok();
    let canon_str = canon.as_ref().map(|p| path_string(p));
    let canon_raw = canon.as_ref().map(|p| p.to_string_lossy().to_string());
    records.retain(|r| {
        r.source_path != source_path
            && canon_str.as_ref().map_or(true, |cs| r.source_path != *cs)
            && canon_raw.as_ref().map_or(true, |cr| r.source_path != *cr)
    });
    if records.len() != before {
        write_skipped(&source_dir, &records)?;
    }
    Ok(())
}

// ── repair crop records ──

fn parse_crop_filename(filename: &str) -> Option<(&str, String)> {
    let marker = "__crop_";
    let idx = filename.rfind(marker)?;
    let stem = &filename[..idx];
    let rest = &filename[idx + marker.len()..];

    let dot_idx = rest.rfind('.')?;
    let ts_part = &rest[..dot_idx];
    let ts_str = ts_part.split('-').next()?;

    let dt = chrono::NaiveDateTime::parse_from_str(ts_str, "%Y%m%d_%H%M%S").ok()?;
    let dt = chrono::Local.from_local_datetime(&dt).single()?;

    Some((stem, dt.to_rfc3339()))
}

fn scan_output_dir(output_dir: &Path) -> (Vec<PathBuf>, Vec<String>) {
    let mut results = Vec::new();
    let mut failures = Vec::new();
    let entries = match fs::read_dir(output_dir) {
        Ok(e) => e,
        Err(e) => {
            failures.push(format!("{}: {}", path_string(output_dir), e));
            return (results, failures);
        }
    };
    for entry in entries {
        match entry {
            Ok(entry) => {
                let path = entry.path();
                if path.is_dir() {
                    let (sub, sub_fail) = scan_output_dir(&path);
                    results.extend(sub);
                    failures.extend(sub_fail);
                } else if crate::paths::is_image_file(&path) {
                    results.push(path);
                }
            }
            Err(e) => {
                failures.push(format!("{}: {}", path_string(output_dir), e));
            }
        }
    }
    (results, failures)
}

fn find_source_image(
    source_dir: &Path,
    rel_parent: &Path,
    stem: &str,
) -> Result<Option<PathBuf>, String> {
    // 1. 在相对目录下找
    for ext in ["jpg", "jpeg", "png"] {
        let candidate = source_dir.join(rel_parent).join(format!("{}.{}", stem, ext));
        if candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    // 2. 全局搜索
    let mut matches = Vec::new();
    fn search_dir(dir: &Path, stem: &str, matches: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if !crate::paths::is_hidden_or_excluded_dir(name) {
                        search_dir(&path, stem, matches);
                    }
                } else if crate::paths::is_image_file(&path) {
                    if let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if file_stem == stem {
                            matches.push(path);
                        }
                    }
                }
            }
        }
    }

    search_dir(source_dir, stem, &mut matches);

    match matches.len() {
        0 => Ok(None),
        1 => Ok(Some(matches.into_iter().next().unwrap())),
        _ => Err(format!("原图 '{}' 找到多个匹配，无法确定", stem)),
    }
}

#[tauri::command]
pub(crate) async fn repair_crop_records_from_output_dir(
    state: tauri::State<'_, AppState>,
) -> Result<crate::models::RepairCropRecordsResult, String> {
    let (source_dir, output_dir, records_lock) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (
            settings.source_dir.clone(),
            settings.output_dir.clone(),
            state.records_lock.clone(),
        )
    };

    if source_dir.is_empty() || output_dir.is_empty() {
        return Err("请先设置图库目录和输出目录".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        repair_crop_records_blocking(source_dir, output_dir, records_lock)
    })
    .await
    .map_err(|e| format!("修复任务失败: {}", e))?
}

fn repair_crop_records_blocking(
    source_dir: String,
    output_dir: String,
    records_lock: Arc<std::sync::Mutex<()>>,
) -> Result<crate::models::RepairCropRecordsResult, String> {
    use crate::models::RepairCropRecordsResult;
    use crate::paths::{
        canonical_source_dir, path_string, relative_path_for_record,
    };
    use crate::records::{read_crops, write_crops};

    let source_root = canonical_source_dir(&source_dir)?;
    let output_root =
        fs::canonicalize(&output_dir).map_err(|e| format!("输出目录无效: {}", e))?;

    // 阶段 1：锁内快速读 records
    let initial_records = {
        let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;
        read_crops(&source_dir)?
    };

    // 阶段 2：锁外扫描、匹配、读尺寸、生成变更计划
    let (crop_files, scan_failures) = scan_output_dir(&output_root);
    let mut failed = scan_failures;

    let mut skipped = 0usize;
    let mut matched_indices: HashMap<usize, String> = HashMap::new();

    let filename_counts: HashMap<String, usize> = crop_files.iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()))
        .fold(HashMap::new(), |mut acc, f| {
            *acc.entry(f).or_insert(0) += 1;
            acc
        });

    // 建立初始索引（锁外，只读内存）
    let mut existing_by_canon: HashMap<String, usize> = HashMap::new();
    let mut existing_by_rel_parent: HashMap<(String, String), Vec<usize>> = HashMap::new();
    let mut existing_by_filename: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, r) in initial_records.iter().enumerate() {
        if let Ok(canon) = fs::canonicalize(&r.output_path) {
            existing_by_canon.insert(path_string(&canon), i);
        }
        let rel_parent = Path::new(&r.relative_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        existing_by_rel_parent
            .entry((rel_parent, r.output_filename.clone()))
            .or_default()
            .push(i);
        existing_by_filename
            .entry(r.output_filename.clone())
            .or_default()
            .push(i);
    }

    // 变更计划
    struct UpdatePlan {
        canon_path: String,
        source_path: Option<String>,
        match_relative_path: String,
        match_output_filename: String,
    }
    let mut updates: Vec<UpdatePlan> = Vec::new();
    let mut additions: Vec<crate::models::CropRecord> = Vec::new();

    for crop_path in crop_files {
        let filename = match crop_path.file_name().and_then(|n| n.to_str()) {
            Some(f) => f,
            None => {
                failed.push(format!("无法读取文件名: {}", path_string(&crop_path)));
                continue;
            }
        };

        let (stem, created_at) = match parse_crop_filename(filename) {
            Some((s, dt)) => (s, dt),
            None => {
                skipped += 1;
                continue;
            }
        };

        let canon_path = match fs::canonicalize(&crop_path) {
            Ok(p) => p,
            Err(e) => {
                failed.push(format!("无法 canonicalize {}: {}", filename, e));
                continue;
            }
        };
        let path_str = path_string(&canon_path);

        let crop_rel_parent = canon_path
            .strip_prefix(&output_root)
            .unwrap_or(Path::new(""))
            .parent()
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .to_string();

        // 匹配 1：canonical output_path
        let mut matched_idx: Option<usize> = None;
        if let Some(&idx) = existing_by_canon.get(&path_str) {
            matched_idx = Some(idx);
        }

        // 匹配 2：(relative_parent, filename)
        if matched_idx.is_none() {
            if let Some(idxs) = existing_by_rel_parent.get(&(crop_rel_parent.clone(), filename.to_string())) {
                if idxs.len() == 1 {
                    matched_idx = Some(idxs[0]);
                }
            }
        }

        // 匹配 3：filename 全局唯一兜底
        if matched_idx.is_none() {
            if let Some(idxs) = existing_by_filename.get(filename) {
                if idxs.len() == 1 && !matched_indices.contains_key(&idxs[0]) {
                    let scan_count = filename_counts.get(filename).copied().unwrap_or(0);
                    if scan_count == 1 {
                        matched_idx = Some(idxs[0]);
                    } else {
                        failed.push(format!("{}: 扫描到多个同名裁剪图，不兜底匹配", filename));
                        continue;
                    }
                } else if idxs.len() > 1 {
                    failed.push(format!("{}: 多个记录同名，无法匹配", filename));
                    continue;
                } else if matched_indices.contains_key(&idxs[0]) {
                    failed.push(format!("{}: 同名记录已被 '{}' 匹配", filename, matched_indices[&idxs[0]]));
                    continue;
                }
            }
        }

        // 已有记录：收集更新计划
        if let Some(idx) = matched_idx {
            let rel_output = canon_path
                .strip_prefix(&output_root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| filename.to_string());
            matched_indices.insert(idx, rel_output);

            // 修正 source_path
            let expected_source = source_root.join(&initial_records[idx].relative_path);
            let new_source = if expected_source.exists() {
                fs::canonicalize(&expected_source).ok().map(|p| path_string(&p))
            } else {
                let stem = Path::new(&initial_records[idx].relative_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let rel_parent = Path::new(&initial_records[idx].relative_path).parent().unwrap_or(Path::new(""));
                match find_source_image(&source_root, rel_parent, stem) {
                    Ok(Some(p)) => Some(path_string(&p)),
                    _ => None,
                }
            };

            if new_source.is_none() {
                failed.push(format!("{}: 原图 '{}' 无法定位", filename, initial_records[idx].relative_path));
            }

            updates.push(UpdatePlan {
                canon_path: path_str,
                source_path: new_source,
                match_relative_path: initial_records[idx].relative_path.clone(),
                match_output_filename: initial_records[idx].output_filename.clone(),
            });
            continue;
        }

        // 新建记录
        let source_image = match find_source_image(&source_root, Path::new(&crop_rel_parent), stem) {
            Ok(Some(p)) => p,
            Ok(None) => {
                failed.push(format!("{}: 找不到原图 '{}'", filename, stem));
                continue;
            }
            Err(e) => {
                failed.push(format!("{}: {}", filename, e));
                continue;
            }
        };

        let (crop_w, crop_h) = match image::image_dimensions(&canon_path) {
            Ok((w, h)) => (w, h),
            Err(e) => {
                failed.push(format!("{}: 无法读取裁剪图尺寸: {}", filename, e));
                continue;
            }
        };

        let (orig_w, orig_h) = match image::image_dimensions(&source_image) {
            Ok((w, h)) => (w, h),
            Err(e) => {
                failed.push(format!("{}: 无法读取原图尺寸: {}", filename, e));
                continue;
            }
        };

        let source_path_str = path_string(&source_image);
        let rel_path = match source_image.strip_prefix(&source_root) {
            Ok(r) => relative_path_for_record(r),
            Err(_) => {
                failed.push(format!("{}: 无法计算相对路径", filename));
                continue;
            }
        };

        additions.push(crate::models::CropRecord {
            source_path: source_path_str,
            relative_path: rel_path,
            crop_name: "recovered".to_string(),
            x: 0,
            y: 0,
            width: crop_w,
            height: crop_h,
            original_width: orig_w,
            original_height: orig_h,
            output_path: path_str,
            output_filename: filename.to_string(),
            ratio_mode: "free".to_string(),
            created_at,
            output_mode: "crop".to_string(),
            rating: 0,
        });
    }

    // 阶段 3：锁内重新读 records，应用变更，写回
    let final_records = {
        let _guard = records_lock.lock().map_err(|e| format!("记录锁错误: {}", e))?;
        let mut records = read_crops(&source_dir)?;

        // 建立最新索引
        let mut latest_by_canon: HashMap<String, usize> = HashMap::new();
        for (i, r) in records.iter().enumerate() {
            if let Ok(canon) = fs::canonicalize(&r.output_path) {
                latest_by_canon.insert(path_string(&canon), i);
            }
        }

        let mut added = 0usize;
        let mut updated_paths = 0usize;

        // 应用 updates（按 relative_path + output_filename 找目标，兼容旧路径失效场景）
        for plan in updates {
            if let Some(idx) = records.iter().position(|r| {
                r.relative_path == plan.match_relative_path && r.output_filename == plan.match_output_filename
            }) {
                if records[idx].output_path != plan.canon_path {
                    records[idx].output_path = plan.canon_path;
                    updated_paths += 1;
                }
                if let Some(new_source) = plan.source_path {
                    if records[idx].source_path != new_source {
                        records[idx].source_path = new_source;
                        updated_paths += 1;
                    }
                }
            }
        }

        // 应用 additions（只用 canonical path 去重，不全局按 filename 一刀切）
        for record in additions {
            if !latest_by_canon.contains_key(&record.output_path) {
                records.push(record);
                added += 1;
            }
        }

        write_crops(&source_dir, &records)?;

        Ok::<_, String>(RepairCropRecordsResult {
            added,
            updated_paths,
            skipped,
            failed,
            records,
        })
    }?;

    Ok(final_records)
}
