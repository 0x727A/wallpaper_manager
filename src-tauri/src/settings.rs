use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::models::{AppState, Settings};
use crate::paths::{
    clean_path_str, is_crops_dir, path_string, strip_crops_suffix, suggested_output_dir,
    validate_output_dir, validate_wallhaven_root,
};

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

pub(crate) fn load_settings(handle: &AppHandle) -> Result<Settings, String> {
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

pub(crate) fn save_settings_to_disk(handle: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(handle)?;
    let text =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("写入设置失败: {}", e))
}

#[tauri::command]
pub(crate) fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    Ok(settings.clone())
}

#[tauri::command]
pub(crate) fn set_output_dir(
    handle: AppHandle,
    state: State<'_, AppState>,
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
pub(crate) fn set_source_dir(
    handle: AppHandle,
    state: State<'_, AppState>,
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
pub(crate) async fn pick_output_dir(
    handle: AppHandle,
    state: State<'_, AppState>,
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
pub(crate) async fn pick_source_dir(
    handle: AppHandle,
    state: State<'_, AppState>,
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
