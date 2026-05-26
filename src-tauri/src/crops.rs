use base64::Engine;
use chrono::Local;
use image::ImageEncoder;
use std::fs;
use std::path::Path;
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
