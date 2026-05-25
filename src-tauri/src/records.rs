use std::fs;
use std::path::Path;
use tauri::State;

use crate::models::{AppState, CropRecord, SkipRecord};
use crate::paths::path_string;

fn crops_json_path(source_dir: &str) -> std::path::PathBuf {
    Path::new(source_dir).join("crops.json")
}

pub(crate) fn read_crops(source_dir: &str) -> Result<Vec<CropRecord>, String> {
    let path = crops_json_path(source_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 crops.json 失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 crops.json 失败: {}", e))
}

pub(crate) fn write_crops(source_dir: &str, records: &[CropRecord]) -> Result<(), String> {
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

fn skipped_json_path(source_dir: &str) -> std::path::PathBuf {
    Path::new(source_dir).join("skipped.json")
}

pub(crate) fn read_skipped(source_dir: &str) -> Result<Vec<SkipRecord>, String> {
    let path = skipped_json_path(source_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 skipped.json 失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 skipped.json 失败: {}", e))
}

pub(crate) fn write_skipped(source_dir: &str, records: &[SkipRecord]) -> Result<(), String> {
    let path = skipped_json_path(source_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(records).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("写入 skipped.json 失败: {}", e))
}

pub(crate) fn remove_skip_record(source_dir: &str, source_path: &str) -> Result<(), String> {
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

#[tauri::command]
pub(crate) fn read_crop_records(state: State<AppState>) -> Result<Vec<CropRecord>, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    read_crops(&settings.source_dir)
}

#[tauri::command]
pub(crate) fn read_skip_records(state: State<AppState>) -> Result<Vec<SkipRecord>, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁错误: {}", e))?;
    read_skipped(&settings.source_dir)
}
