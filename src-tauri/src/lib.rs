use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod models;
use crate::models::*;
mod paths;
mod records;
use crate::records::*;
mod gallery;
use crate::gallery::*;
mod thumbnails;
use crate::thumbnails::*;
mod crops;
use crate::crops::*;
mod batch;
use crate::batch::*;
mod settings;
use crate::settings::*;

// ── Tauri setup ──

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = load_settings(&app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(AppState {
                settings: Mutex::new(settings),
                cancel_flags: Mutex::new(HashMap::new()),
                records_lock: Arc::new(Mutex::new(())),
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
            resolve_preview_image,
            save_crop,
            read_crop_records,
            run_batch_from_json,
            cancel_batch,
            delete_original_image,
            resolve_cropped_image_path,
            ensure_cropped_thumbnails,
            resolve_original_for_record,
            preview_crop,
            save_recrop,
            read_skip_records,
            skip_image,
            unskip_image,
            delete_crop_record,
            set_crop_records_rating,
            repair_crop_records_from_output_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
