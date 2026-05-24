use base64::Engine;
use chrono::Local;
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const APP_NAME: &str = "WallhavenCrops";

// ── Data structures ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    pub source_dir: String,
    pub output_dir: String,
}

#[derive(Serialize, Clone)]
pub struct ImageEntry {
    pub source_path: String,
    pub relative_path: String,
    pub filename: String,
    pub is_nsfw: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CropRecord {
    pub source_path: String,
    pub relative_path: String,
    pub crop_name: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub output_path: String,
    pub output_filename: String,
    pub ratio_mode: String,
    pub created_at: String,
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
    #[serde(default)]
    pub rating: u8,
}

fn default_output_mode() -> String {
    "crop".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkipRecord {
    pub source_path: String,
    pub relative_path: String,
    pub filename: String,
    pub skipped_at: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SaveCropRequest {
    pub source_path: String,
    pub crop_name: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub ratio_mode: String,
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
    #[serde(default)]
    pub rating: u8,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchFailure {
    pub source_path: String,
    pub reason: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchProgress {
    pub total: usize,
    pub done: usize,
    pub success: usize,
    pub failed: usize,
    pub current: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchResult {
    pub success: usize,
    pub failed: usize,
    pub failures: Vec<BatchFailure>,
    pub cancelled: bool,
    pub total: usize,
    pub done: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct PreviewImage {
    pub data_url: String,
    pub original_width: u32,
    pub original_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

// ── Helpers ──

fn canonical_source_dir(source_dir: &str) -> Result<PathBuf, String> {
    fs::canonicalize(source_dir).map_err(|e| format!("无法访问图库目录: {}", e))
}

fn clean_path_str(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

fn path_string(path: &Path) -> String {
    clean_path_str(&path.to_string_lossy())
}

fn suggested_output_dir(source_dir: &Path) -> Result<PathBuf, String> {
    let name = source_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(APP_NAME);
    if let Some(parent) = source_dir.parent() {
        Ok(parent.join(format!("{}Crops", name)))
    } else {
        dirs::desktop_dir()
            .map(|d| d.join(format!("{}Crops", name)))
            .ok_or_else(|| "无法获取桌面目录".into())
    }
}

fn validate_source_path(source_dir: &str, path: &str) -> Result<PathBuf, String> {
    let canon = fs::canonicalize(path).map_err(|e| format!("路径无效: {}", e))?;
    let root = canonical_source_dir(source_dir)?;
    if !canon.starts_with(&root) {
        return Err("路径不在允许的图库目录内".into());
    }
    let rel = canon.strip_prefix(&root).unwrap_or(Path::new(""));
    for comp in rel.components() {
        let name = comp.as_os_str().to_string_lossy();
        if name == "_deleted" || name == "_cropped" {
            return Err("路径位于排除目录内".into());
        }
    }
    if !canon.is_file() || !is_image_file(&canon) {
        return Err("不是支持的图片文件".into());
    }
    Ok(canon)
}

fn validate_output_dir(path: &str, source_dir: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("输出目录不能为空".into());
    }
    let p = Path::new(path);

    let mut missing_parts: Vec<&std::ffi::OsStr> = Vec::new();
    let mut current = p;
    while !current.exists() {
        if let Some(name) = current.file_name() {
            missing_parts.push(name);
        }
        if let Some(parent) = current.parent() {
            current = parent;
        } else {
            break;
        }
    }

    if current.exists() && !source_dir.is_empty() {
        let existing_canon = fs::canonicalize(current).map_err(|e| format!("路径无效: {}", e))?;
        let source_root = canonical_source_dir(source_dir)?;
        let mut intended = existing_canon;
        for part in missing_parts.iter().rev() {
            intended = intended.join(part);
        }
        if intended.starts_with(&source_root) {
            return Err("输出目录不能位于图库目录内".into());
        }
    }

    fs::create_dir_all(path).map_err(|e| format!("创建目录失败: {}", e))?;
    let canon = fs::canonicalize(path).map_err(|e| format!("路径无效: {}", e))?;

    if !source_dir.is_empty() {
        let source_root = canonical_source_dir(source_dir)?;
        if canon.starts_with(&source_root) {
            return Err("输出目录不能位于图库目录内".into());
        }
    }

    Ok(canon)
}

fn is_crops_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| name.ends_with("Crops"))
        .unwrap_or(false)
}

fn strip_crops_suffix(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    let base = name.strip_suffix("Crops")?;
    Some(path.parent()?.join(base))
}

fn is_image_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png")
}

fn is_hidden_or_excluded_dir(name: &str) -> bool {
    name.starts_with('.') || name == "_deleted" || name == "_cropped"
}

fn relative_path_for_record(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn sanitize_filename(name: &str) -> String {
    name.replace(
        |c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'),
        "_",
    )
}

fn detect_nsfw(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(Path::new(""));
    let s = rel.to_string_lossy().to_lowercase();
    s.contains("nsfw") || s.contains("explicit") || s.contains("porn")
}

fn settings_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[derive(Deserialize, Debug)]
struct PartialSettings {
    source_dir: Option<String>,
    output_dir: Option<String>,
}

fn load_settings(handle: &AppHandle) -> Result<Settings, String> {
    let path = settings_path(handle)?;
    let mut source_dir = String::new();
    let mut output_dir = String::new();
    let mut changed = false;

    if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| format!("读取设置失败: {}", e))?;
        let partial: PartialSettings =
            serde_json::from_str(&text).map_err(|e| format!("解析设置失败: {}", e))?;
        if let Some(ref sd) = partial.source_dir {
            if !sd.is_empty() {
                source_dir = clean_path_str(sd);
            }
        }
        if let Some(ref od) = partial.output_dir {
            if !od.is_empty() {
                output_dir = clean_path_str(od);
            }
        }
    }

    // 自动修正反向路径
    if !source_dir.is_empty() {
        let source_path = Path::new(&source_dir);
        let output_path = Path::new(&output_dir);
        if is_crops_dir(source_path) && !is_crops_dir(output_path) {
            std::mem::swap(&mut source_dir, &mut output_dir);
            changed = true;
        }
        if is_crops_dir(Path::new(&source_dir)) {
            if let Some(candidate) = strip_crops_suffix(Path::new(&source_dir)) {
                if candidate.is_dir() {
                    source_dir = path_string(&candidate);
                    output_dir = path_string(&suggested_output_dir(&candidate)?);
                    changed = true;
                }
            }
        }
    }

    // 如果 source_dir 非空但 output_dir 为空，自动计算
    if !source_dir.is_empty() && output_dir.is_empty() {
        output_dir = path_string(&suggested_output_dir(Path::new(&source_dir))?);
        changed = true;
    }

    let settings = Settings {
        source_dir,
        output_dir,
    };
    if changed {
        save_settings_to_disk(handle, &settings)?;
    }
    Ok(settings)
}

fn save_settings_to_disk(handle: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(handle)?;
    let text =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("写入设置失败: {}", e))
}

fn crops_json_path(source_dir: &str) -> PathBuf {
    Path::new(source_dir).join("crops.json")
}

fn read_crops(source_dir: &str) -> Result<Vec<CropRecord>, String> {
    let path = crops_json_path(source_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 crops.json 失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 crops.json 失败: {}", e))
}

fn write_crops(source_dir: &str, records: &[CropRecord]) -> Result<(), String> {
    let path = crops_json_path(source_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(records).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, text).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "无法写入 crops.json，请确认图库目录可写。建议把图库复制到本机后再使用。".into()
        } else {
            format!("写入 crops.json 失败: {}", e)
        }
    })
}

fn skipped_json_path(source_dir: &str) -> PathBuf {
    Path::new(source_dir).join("skipped.json")
}

fn read_skipped(source_dir: &str) -> Result<Vec<SkipRecord>, String> {
    let path = skipped_json_path(source_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 skipped.json 失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 skipped.json 失败: {}", e))
}

fn write_skipped(source_dir: &str, records: &[SkipRecord]) -> Result<(), String> {
    let path = skipped_json_path(source_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(records).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("写入 skipped.json 失败: {}", e))
}

fn remove_skip_record(source_dir: &str, source_path: &str) -> Result<(), String> {
    let mut records = read_skipped(source_dir)?;
    let before = records.len();
    let canon = fs::canonicalize(source_path).ok();
    let canon_str = canon.as_ref().map(|p| path_string(p));
    let canon_raw = canon.as_ref().map(|p| p.to_string_lossy().to_string());
    records.retain(|r| {
        r.source_path != source_path
            && canon_str.as_ref().map_or(true, |cs| r.source_path != *cs)
            && canon_raw.as_ref().map_or(true, |cr| r.source_path != *cr)
    });
    if records.len() != before {
        write_skipped(source_dir, &records)?;
    }
    Ok(())
}

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

fn create_crop_file(
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
        rgba.save(&out_path).map_err(|e| format!("保存遮罩图失败: {}", e))?;
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

// ── Commands ──

#[tauri::command]
async fn scan_images(
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
fn get_settings(state: tauri::State<AppState>) -> Result<Settings, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    Ok(settings.clone())
}

#[tauri::command]
fn set_output_dir(
    handle: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Settings, String> {
    let source_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        settings.source_dir.clone()
    };

    let canon = validate_output_dir(&path, &source_dir)?;
    let canon_str = path_string(&canon);
    let mut settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    settings.output_dir = canon_str;
    save_settings_to_disk(&handle, &settings)?;
    Ok(settings.clone())
}

#[tauri::command]
fn set_source_dir(
    handle: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Settings, String> {
    if path.trim().is_empty() {
        return Err("图库目录不能为空".into());
    }
    let meta = fs::metadata(&path).map_err(|e| format!("路径无效: {}", e))?;
    if !meta.is_dir() {
        return Err("图库目录必须是文件夹".into());
    }
    let canon = fs::canonicalize(&path).map_err(|e| format!("路径无效: {}", e))?;
    let canon_str = path_string(&canon);

    validate_wallhaven_root(&canon)?;

    if is_crops_dir(&canon) {
        return Err("请选择原图库目录，不要选择裁剪输出目录".into());
    }

    let mut settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    // Auto-set output_dir if empty or collides with new source_dir
    let should_auto_output = settings.output_dir.is_empty()
        || validate_output_dir(&settings.output_dir, &canon_str).is_err();
    if should_auto_output {
        settings.output_dir = path_string(&suggested_output_dir(&canon)?);
    }
    settings.source_dir = canon_str;
    save_settings_to_disk(&handle, &settings)?;
    Ok(settings.clone())
}

#[tauri::command]
async fn pick_output_dir(
    handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let start_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        let current = settings.output_dir.clone();
        if !current.is_empty() && Path::new(&current).exists() {
            current
        } else {
            dirs::desktop_dir()
                .map(|d| path_string(&d))
                .unwrap_or_default()
        }
    };

    let folder = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = handle.dialog().file().set_title("选择裁剪输出目录");
        if !start_dir.is_empty() {
            builder = builder.set_directory(&start_dir);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.and_then(|p| p.into_path().ok().map(|p| path_string(&p))))
}

#[tauri::command]
async fn pick_source_dir(
    handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let start_dir = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁错误: {}", e))?;
        let current = settings.source_dir.clone();
        if !current.is_empty() && Path::new(&current).exists() {
            current
        } else {
            dirs::desktop_dir()
                .map(|d| path_string(&d))
                .unwrap_or_default()
        }
    };

    let folder = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = handle.dialog().file().set_title("选择原图库目录");
        if !start_dir.is_empty() {
            builder = builder.set_directory(&start_dir);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.and_then(|p| p.into_path().ok().map(|p| path_string(&p))))
}

#[tauri::command]
async fn pick_json_file(handle: AppHandle) -> Result<Option<String>, String> {
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

#[tauri::command]
async fn ensure_thumbnail(
    handle: AppHandle,
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
    let thumb_dir = cache_dir
        .join("thumbs")
        .join(rel.parent().unwrap_or(Path::new("")));

    let filename = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("thumb.jpg");
    let thumb_path = thumb_dir.join(&filename);

    // Fast path: cache exists, return immediately
    if thumb_path.exists() {
        return Ok(path_string(&thumb_path));
    }

    // Generate thumbnail in blocking thread
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
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("生成缩略图任务失败: {}", e))??;

    Ok(path_string(&thumb_path))
}

#[tauri::command]
async fn read_preview_image(
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
async fn save_crop(
    handle: AppHandle,
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
fn delete_crop_record(
    state: tauri::State<'_, AppState>,
    output_path: String,
) -> Result<CropRecord, String> {
    let (source_dir, output_dir) = {
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
        if let (Some(target), Ok(record_canon)) = (&target_canon, fs::canonicalize(&r.output_path)) {
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
    let _out_dir = if output_dir.is_empty() {
        suggested_output_dir(Path::new(&source_dir)).ok()
    } else {
        fs::canonicalize(&output_dir).ok()
    };

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
fn read_crop_records(state: tauri::State<AppState>) -> Result<Vec<CropRecord>, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    read_crops(&settings.source_dir)
}

#[tauri::command]
fn resolve_cropped_image_path(
    handle: AppHandle,
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

async fn generate_crop_thumbnail(
    handle: &AppHandle,
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

    let path_clone = path.clone();
    let thumb_dir_clone = thumb_dir.clone();
    let thumb_path_clone = thumb_path.clone();
    let hash_clone = hash.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&thumb_dir_clone).map_err(|e| format!("创建缩略图目录失败: {}", e))?;
        let img = image::open(&path_clone).map_err(|e| format!("打开图片失败: {}", e))?;
        let thumb = img.thumbnail(360, 360);
        let unique_suffix = format!("{:?}", std::thread::current().id());
        let tmp_name = format!(".tmp.{}.{}.{}", hash_clone, unique_suffix, filename);
        let tmp_path = thumb_dir_clone.join(&tmp_name);
        thumb
            .save(&tmp_path)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
        if let Err(e) = fs::rename(&tmp_path, &thumb_path_clone) {
            if thumb_path_clone.exists() {
                let _ = fs::remove_file(&tmp_path);
                return Ok(());
            }
            return Err(format!("重命名缩略图失败: {}", e));
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("生成缩略图任务失败: {}", e))??;

    Ok(path_string(&thumb_path))
}

#[tauri::command]
async fn ensure_cropped_thumbnail(
    handle: AppHandle,
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

fn run_batch_from_json_blocking(
    source_dir: &str,
    output_dir: &str,
    json_path: &str,
    handle: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<BatchResult, String> {
    let text = fs::read_to_string(json_path).map_err(|e| format!("读取 JSON 失败: {}", e))?;
    let records: Vec<CropRecord> =
        serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let mut existing_records = read_crops(source_dir)?;
    let total = records.len();
    let mut success = 0usize;
    let mut failures = Vec::new();
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
                existing_records.push(new_record);
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

    write_crops(source_dir, &existing_records)?;

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

    let cancelled = cancel_flag.load(Ordering::Relaxed);
    let final_progress = BatchProgress {
        total,
        done,
        success,
        failed: failures.len(),
        current: if cancelled { "已取消".to_string() } else { "".to_string() },
    };
    let _ = handle.emit(format!("batch-progress-{}", job_id).as_str(), final_progress);

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
async fn run_batch_from_json(
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

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_batch_from_json_blocking(
            &source_dir_clone,
            &output_dir_clone,
            &json_path_clone,
            &handle_clone,
            &job_id_clone,
            &cancel_flag_clone,
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
fn cancel_batch(state: tauri::State<'_, AppState>, job_id: String) -> Result<(), String> {
    let flags = state
        .cancel_flags
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    if let Some(flag) = flags.get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn delete_original_image(state: tauri::State<'_, AppState>, source_path: String) -> Result<(), String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;

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

#[derive(Deserialize, Clone, Debug)]
struct SaveRecropRequest {
    old_output_path: String,
    crop: SaveCropRequest,
}

#[derive(Serialize, Clone, Debug)]
struct CropPreview {
    data_url: String,
    width: u32,
    height: u32,
}

#[tauri::command]
fn resolve_original_for_record(
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

#[tauri::command]
async fn preview_crop(
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
            (img_w, img_h, image::DynamicImage::ImageRgba8(rgba).to_rgb8())
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
async fn save_recrop(
    handle: AppHandle,
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
fn read_skip_records(state: tauri::State<AppState>) -> Result<Vec<SkipRecord>, String> {
    let settings = state.settings.lock().map_err(|e| format!("锁错误: {}", e))?;
    read_skipped(&settings.source_dir)
}

#[tauri::command]
fn skip_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<SkipRecord, String> {
    let settings = state.settings.lock().map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    let canon = validate_source_path(&source_dir, &source_path)?;
    let root = canonical_source_dir(&source_dir)?;
    let rel = relative_path_for_record(canon.strip_prefix(&root).map_err(|_| "无法计算相对路径")?);
    let filename = canon.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();

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
fn unskip_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<(), String> {
    let settings = state.settings.lock().map_err(|e| format!("锁错误: {}", e))?;
    let source_dir = settings.source_dir.clone();
    drop(settings);

    remove_skip_record(&source_dir, &source_path)
}

// ── Tauri setup ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn validate_wallhaven_root(dir: &Path) -> Result<(), String> {
    if !dir.exists() || !dir.is_dir() {
        return Err("请选择有效的目录".into());
    }

    // 禁止选择输出目录/Crops 目录
    if is_crops_dir(dir) {
        return Err("请选择原图库目录，不要选择裁剪输出目录".into());
    }

    // 禁止选择排除目录
    if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
        if name == "_deleted" || name == "_cropped" {
            return Err("不能选择排除目录".into());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_clean_path_str_strips_windows_device_prefix() {
        assert_eq!(
            clean_path_str(r"\\?\C:\Wallhaven\img.jpg"),
            r"C:\Wallhaven\img.jpg"
        );
    }

    #[test]
    fn test_clean_path_str_strips_windows_unc_prefix() {
        assert_eq!(
            clean_path_str(r"\\?\UNC\server\share\img.jpg"),
            r"\\server\share\img.jpg"
        );
    }

    #[test]
    fn test_sfw_subdir_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let sfw = tmp.path().join("Wallhaven").join("SFW");
        fs::create_dir_all(&sfw).unwrap();
        assert!(validate_wallhaven_root(&sfw).is_ok());
    }

    #[test]
    fn test_nsfw_subdir_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let nsfw = tmp.path().join("Wallhaven").join("NSFW");
        fs::create_dir_all(&nsfw).unwrap();
        assert!(validate_wallhaven_root(&nsfw).is_ok());
    }

    #[test]
    fn test_xxx_subdir_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let xxx = tmp.path().join("Wallhaven").join("XXX");
        fs::create_dir_all(&xxx).unwrap();
        assert!(validate_wallhaven_root(&xxx).is_ok());
    }

    #[test]
    fn test_root_with_sfw_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Wallhaven");
        fs::create_dir_all(root.join("SFW")).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }

    #[test]
    fn test_root_with_nsfw_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Wallhaven");
        fs::create_dir_all(root.join("NSFW")).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }

    #[test]
    fn test_root_with_xxx_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Wallhaven");
        fs::create_dir_all(root.join("XXX")).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }

    #[test]
    fn test_root_without_category_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Wallhaven");
        fs::create_dir_all(&root).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }

    #[test]
    fn test_crops_dir_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let crops = tmp.path().join("WallhavenCrops");
        fs::create_dir_all(&crops).unwrap();
        assert!(validate_wallhaven_root(&crops).is_err());
    }

    #[test]
    fn test_deleted_dir_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let deleted = tmp.path().join("_deleted");
        fs::create_dir_all(&deleted).unwrap();
        assert!(validate_wallhaven_root(&deleted).is_err());
    }

    #[test]
    fn test_root_with_mixed_case_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Wallhaven");
        fs::create_dir_all(root.join("sfw")).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }

    #[test]
    fn test_root_name_case_insensitive_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("wallhaven");
        fs::create_dir_all(root.join("SFW")).unwrap();
        assert!(validate_wallhaven_root(&root).is_ok());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = load_settings(&app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(AppState {
                settings: Mutex::new(settings),
                cancel_flags: Mutex::new(HashMap::new()),
            });

            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            let thumb_dir = cache_dir.join("thumbs");
            fs::create_dir_all(&thumb_dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.asset_protocol_scope()
                .allow_directory(&thumb_dir, true)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            let crop_thumb_dir = cache_dir.join("crop_thumbs");
            fs::create_dir_all(&crop_thumb_dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.asset_protocol_scope()
                .allow_directory(&crop_thumb_dir, true)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
                let menu = Menu::with_items(
                    app,
                    &[
                        &Submenu::with_items(
                            app,
                            "应用",
                            true,
                            &[
                                &PredefinedMenuItem::about(
                                    app,
                                    Some("关于 Wallhaven 图片裁剪记录器"),
                                    None,
                                )?,
                                &PredefinedMenuItem::separator(app)?,
                                &PredefinedMenuItem::quit(app, Some("退出"))?,
                            ],
                        )?,
                        &Submenu::with_items(
                            app,
                            "编辑",
                            true,
                            &[
                                &PredefinedMenuItem::copy(app, Some("复制"))?,
                                &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                                &PredefinedMenuItem::select_all(app, Some("全选"))?,
                            ],
                        )?,
                        &Submenu::with_items(
                            app,
                            "显示",
                            true,
                            &[&PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?],
                        )?,
                        &Submenu::with_items(
                            app,
                            "窗口",
                            true,
                            &[
                                &PredefinedMenuItem::minimize(app, Some("最小化"))?,
                                &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                                &PredefinedMenuItem::separator(app)?,
                                &PredefinedMenuItem::bring_all_to_front(app, Some("前置窗口"))?,
                            ],
                        )?,
                    ],
                )?;
                app.set_menu(menu)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_images,
            get_settings,
            set_output_dir,
            set_source_dir,
            pick_output_dir,
            pick_source_dir,
            pick_json_file,
            ensure_thumbnail,
            read_preview_image,
            save_crop,
            read_crop_records,
            run_batch_from_json,
            cancel_batch,
            delete_original_image,
            resolve_cropped_image_path,
            ensure_cropped_thumbnail,
            resolve_original_for_record,
            preview_crop,
            save_recrop,
            read_skip_records,
            skip_image,
            unskip_image,
            delete_crop_record,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
