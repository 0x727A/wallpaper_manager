use base64::Engine;
use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::models::{AppState, CropRecord, PreviewImage};
use crate::paths::{canonical_source_dir, is_image_file, path_string, validate_source_path};
use crate::records::read_crops;

fn source_dir_hash(source_dir: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    source_dir.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn thumb_meta_path(thumb_path: &Path) -> PathBuf {
    let filename = thumb_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("thumb");
    thumb_path.with_file_name(format!("{}.meta", filename))
}

fn write_thumb_meta(
    meta_path: &Path,
    size: u64,
    mtime: std::time::SystemTime,
) -> Result<(), String> {
    let dur = mtime
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let content = format!("{}|{}|{}", size, dur.as_secs(), dur.subsec_nanos());
    fs::write(meta_path, content).map_err(|e| format!("写入缩略图 meta 失败: {}", e))
}

fn read_thumb_meta(meta_path: &Path) -> Option<(u64, std::time::SystemTime)> {
    let content = fs::read_to_string(meta_path).ok()?;
    let mut parts = content.split('|');
    let size: u64 = parts.next()?.parse().ok()?;
    let secs: u64 = parts.next()?.parse().ok()?;
    let nanos: u32 = parts.next()?.parse().ok()?;
    let mtime = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::new(secs, nanos);
    Some((size, mtime))
}

fn is_thumb_stale(source_path: &Path, thumb_path: &Path) -> bool {
    let meta_path = thumb_meta_path(thumb_path);
    let (saved_size, saved_mtime) = match read_thumb_meta(&meta_path) {
        Some(v) => v,
        None => return true,
    };
    let source_meta = match fs::metadata(source_path) {
        Ok(m) => m,
        Err(_) => return true,
    };
    source_meta.len() != saved_size
        || source_meta
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            != saved_mtime
}

#[tauri::command]
pub(crate) async fn ensure_thumbnail(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<String, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;
    let rel = canon.strip_prefix(&root).map_err(|_| "无法计算相对路径")?;

    let cache_dir = handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法获取缓存目录: {}", e))?;
    let source_hash = source_dir_hash(&source_dir);
    let thumb_dir = cache_dir
        .join("thumbs")
        .join(&source_hash[..2])
        .join(&source_hash[2..4])
        .join(&source_hash)
        .join(rel.parent().unwrap_or(Path::new("")));

    let filename = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("thumb.jpg");
    let thumb_path = thumb_dir.join(&filename);

    if thumb_path.exists() && !is_thumb_stale(&canon, &thumb_path) {
        return Ok(path_string(&thumb_path));
    }

    if thumb_path.exists() {
        let _ = fs::remove_file(&thumb_path);
        let _ = fs::remove_file(&thumb_meta_path(&thumb_path));
    }

    let canon_clone = canon.clone();
    let thumb_dir_clone = thumb_dir.clone();
    let thumb_path_clone = thumb_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&thumb_dir_clone).map_err(|e| format!("创建缩略图目录失败: {}", e))?;
        let img = image::open(&canon_clone).map_err(|e| format!("打开图片失败: {}", e))?;
        let thumb = img.thumbnail(240, 240);
        thumb
            .save(&thumb_path_clone)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;

        let source_meta =
            fs::metadata(&canon_clone).map_err(|e| format!("读取源文件元数据失败: {}", e))?;
        let mtime = source_meta
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let meta_path = thumb_meta_path(&thumb_path_clone);
        write_thumb_meta(&meta_path, source_meta.len(), mtime)?;

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("生成缩略图任务失败: {}", e))??;

    Ok(path_string(&thumb_path))
}

#[tauri::command]
pub(crate) async fn read_preview_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<PreviewImage, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let canon = validate_source_path(&source_dir, &source_path)?;
        let img = image::open(&canon).map_err(|e| format!("打开图片失败: {}", e))?;
        let (orig_w, orig_h) = (img.width(), img.height());

        let preview = if orig_w.max(orig_h) > 1800 {
            img.thumbnail(1800, 1800)
        } else {
            img
        };

        let rgb = preview.to_rgb8();
        let mut buffer: Vec<u8> = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 75);
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

        Ok(PreviewImage {
            data_url,
            original_width: orig_w,
            original_height: orig_h,
            preview_width: preview.width(),
            preview_height: preview.height(),
        })
    })
    .await
    .map_err(|e| format!("读取预览图任务失败: {}", e))
    .and_then(|r| r)
}

pub(crate) fn generate_crop_thumbnail_sync(
    handle: &tauri::AppHandle,
    output_path: &str,
) -> Result<String, String> {
    let path = fs::canonicalize(output_path).map_err(|e| format!("裁剪图不存在: {}", e))?;

    let cache_dir = handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法获取缓存目录: {}", e))?;
    let hash = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    };
    let thumb_dir = cache_dir
        .join("crop_thumbs")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(&hash);
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("thumb.jpg")
        .to_string();
    let thumb_path = thumb_dir.join(&filename);

    if thumb_path.exists() {
        return Ok(path_string(&thumb_path));
    }

    fs::create_dir_all(&thumb_dir).map_err(|e| format!("创建缩略图目录失败: {}", e))?;
    let img = image::open(&path).map_err(|e| format!("打开图片失败: {}", e))?;
    let thumb = img.thumbnail(360, 360);
    let unique_suffix = format!("{:?}", std::thread::current().id());
    let tmp_name = format!(".tmp.{}.{}.{}", hash, unique_suffix, filename);
    let tmp_path = thumb_dir.join(&tmp_name);
    thumb
        .save(&tmp_path)
        .map_err(|e| format!("保存缩略图失败: {}", e))?;
    if let Err(e) = fs::rename(&tmp_path, &thumb_path) {
        if thumb_path.exists() {
            let _ = fs::remove_file(&tmp_path);
            return Ok(path_string(&thumb_path));
        }
        return Err(format!("重命名缩略图失败: {}", e));
    }

    Ok(path_string(&thumb_path))
}

pub(crate) async fn generate_crop_thumbnail(
    handle: &tauri::AppHandle,
    output_path: &str,
) -> Result<String, String> {
    let handle = handle.clone();
    let output_path = output_path.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        generate_crop_thumbnail_sync(&handle, &output_path)
    })
    .await
    .map_err(|e| format!("生成缩略图任务失败: {}", e))
    .and_then(|r| r)
}

#[tauri::command]
pub(crate) async fn ensure_cropped_thumbnail(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    output_path: String,
) -> Result<String, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

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

    generate_crop_thumbnail(&handle, &output_path).await
}

#[tauri::command]
pub(crate) async fn ensure_cropped_thumbnails(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    output_paths: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    let handle_clone = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let records = read_crops(&source_dir)?;
        let record_map: HashMap<String, &CropRecord> =
            records.iter().map(|r| (r.output_path.clone(), r)).collect();

        let mut result = HashMap::new();
        for output_path in &output_paths {
            if !record_map.contains_key(output_path) {
                continue;
            }
            if !is_image_file(Path::new(output_path)) {
                continue;
            }

            match generate_crop_thumbnail_sync(&handle_clone, output_path) {
                Ok(thumb_path) => {
                    result.insert(output_path.clone(), thumb_path);
                }
                Err(e) => {
                    eprintln!("批量缩略图生成失败: {} - {}", output_path, e);
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("批量缩略图任务失败: {}", e))
    .and_then(|r| r)
}
