use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

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
pub struct ResolvedPreview {
    pub src_path: String,
    pub original_width: u32,
    pub original_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SaveRecropRequest {
    pub(crate) old_output_path: String,
    pub(crate) crop: SaveCropRequest,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct SaveRecropResult {
    pub(crate) record: CropRecord,
    pub(crate) warning: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct CropPreview {
    pub(crate) data_url: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Serialize, Clone, Debug)]
pub struct RepairCropRecordsResult {
    pub added: usize,
    pub updated_paths: usize,
    pub skipped: usize,
    pub failed: Vec<String>,
    pub records: Vec<CropRecord>,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub records_lock: Arc<Mutex<()>>,
}
