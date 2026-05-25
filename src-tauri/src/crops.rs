use base64::Engine;
use chrono::Local;
use image::ImageEncoder;
use std::fs;
use std::path::Path;
use tauri::Manager;

use crate::models::{
    AppState, CropPreview, CropRecord, SaveCropRequest, SaveRecropRequest, SkipRecord,
};
use crate::paths::{
    canonical_source_dir, is_image_file, path_string, relative_path_for_record, sanitize_filename,
    validate_source_path,
};
use crate::records::{read_crops, read_skipped, remove_skip_record, write_crops, write_skipped};
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
        rgba.save(&out_path)
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

    let mut records = read_crops(source_dir)?;
    records.push(record.clone());
    write_crops(source_dir, &records)?;

    if let Err(e) = remove_skip_record(source_dir, &request.source_path) {
        eprintln!("保存裁剪成功，但清除跳过记录失败: {}", e);
    }

    Ok(record)
}

#[tauri::command]
pub(crate) async fn save_crop(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: SaveCropRequest,
) -> Result<CropRecord, String> {
    let (source_dir, output_dir) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), settings.output_dir.clone())
    };

    let source_dir_clone = source_dir.clone();
    let output_dir_clone = output_dir.clone();
    let request_clone = request;
    let record = tauri::async_runtime::spawn_blocking(move || {
        save_crop_blocking(&source_dir_clone, &output_dir_clone, &request_clone)
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
    let (source_dir, _output_dir) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), settings.output_dir.clone())
    };

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

    // 2. 校验输出目录（仅用于日志/参考，不限制删除）
    // 旧输出目录中的历史记录也允许删除；安全边界是必须先匹配 crops.json 记录。

    // 3. 删除文件（文件不存在也继续）
    if let Some(ref p) = target_canon {
        if p.exists() {
            if let Err(e) = fs::remove_file(p) {
                return Err(format!("删除裁剪图失败: {}", e));
            }
        }
    }

    // 4. 写回 crops.json
    write_crops(&source_dir, &records)?;

    Ok(removed)
}

#[tauri::command]
pub(crate) fn resolve_cropped_image_path(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    output_path: String,
) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    let records = read_crops(&source_dir)?;
    let path = fs::canonicalize(&output_path).map_err(|e| format!("裁剪图不存在: {}", e))?;
    let found = records.iter().any(|r| {
        if r.output_path == output_path {
            return true;
        }
        // 字符串不匹配时才走 canonical 慢路径
        if let Ok(rp) = fs::canonicalize(&r.output_path) {
            return path == rp;
        }
        false
    });
    if !found {
        return Err("裁剪图不在记录中".into());
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
) -> Result<CropRecord, String> {
    let mut records = read_crops(source_dir)?;
    let idx = records
        .iter()
        .position(|r| r.output_path == request.old_output_path)
        .ok_or_else(|| "未找到旧裁剪记录".to_string())?;

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

    records[idx] = record.clone();

    if let Err(e) = write_crops(source_dir, &records) {
        if let Err(del_e) = fs::remove_file(&record.output_path) {
            eprintln!("写入 crops.json 失败后清理新裁剪图失败: {}", del_e);
        }
        return Err(e);
    }

    let old_path = fs::canonicalize(&request.old_output_path).ok();
    let output_root = fs::canonicalize(output_dir).map_err(|e| format!("输出目录无效: {}", e))?;

    if let Some(old_path) = old_path {
        let new_path = fs::canonicalize(&record.output_path).ok();
        if old_path.starts_with(&output_root) && Some(old_path.as_path()) != new_path.as_deref() {
            if let Err(e) = fs::remove_file(&old_path) {
                eprintln!("删除旧裁剪图失败: {}", e);
            }
        }
    }

    Ok(record)
}

#[tauri::command]
pub(crate) async fn save_recrop(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: SaveRecropRequest,
) -> Result<CropRecord, String> {
    let (source_dir, output_dir) = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        (settings.source_dir.clone(), settings.output_dir.clone())
    };

    let source_dir_clone = source_dir.clone();
    let output_dir_clone = output_dir.clone();
    let request_clone = request;
    let record = tauri::async_runtime::spawn_blocking(move || {
        save_recrop_blocking(&source_dir_clone, &output_dir_clone, &request_clone)
    })
    .await
    .map_err(|e| format!("重裁保存任务失败: {}", e))
    .and_then(|r| r)?;

    let thumb_handle = handle.clone();
    let thumb_path = record.output_path.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = generate_crop_thumbnail(&thumb_handle, &thumb_path).await {
            eprintln!("重裁保存成功，但生成缩略图失败: {}", e);
        }
    });

    Ok(record)
}

#[tauri::command]
pub(crate) fn skip_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<SkipRecord, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;
    let rel = relative_path_for_record(canon.strip_prefix(&root).map_err(|_| "无法计算相对路径")?);
    let filename = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

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
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    remove_skip_record(&source_dir, &source_path)
}
