use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const APP_NAME: &str = "WallhavenCrops";

pub(crate) fn canonical_source_dir(source_dir: &str) -> Result<PathBuf, String> {
    fs::canonicalize(source_dir).map_err(|e| format!("无法访问图库目录: {}", e))
}

pub(crate) fn clean_path_str(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

pub(crate) fn path_string(path: &Path) -> String {
    clean_path_str(&path.to_string_lossy())
}

pub(crate) fn suggested_output_dir(source_dir: &Path) -> Result<PathBuf, String> {
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

pub(crate) fn validate_source_path(source_dir: &str, path: &str) -> Result<PathBuf, String> {
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

pub(crate) fn validate_output_dir(path: &str, source_dir: &str) -> Result<PathBuf, String> {
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

pub(crate) fn is_crops_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| name.ends_with("Crops"))
        .unwrap_or(false)
}

pub(crate) fn strip_crops_suffix(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    let base = name.strip_suffix("Crops")?;
    Some(path.parent()?.join(base))
}

pub(crate) fn is_image_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png")
}

pub(crate) fn is_hidden_or_excluded_dir(name: &str) -> bool {
    name.starts_with('.') || name == "_deleted" || name == "_cropped"
}

pub(crate) fn relative_path_for_record(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

pub(crate) fn sanitize_filename(name: &str) -> String {
    name.replace(
        |c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'),
        "_",
    )
}

pub(crate) fn detect_nsfw(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(Path::new(""));
    let s = rel.to_string_lossy().to_lowercase();
    s.contains("nsfw") || s.contains("explicit") || s.contains("porn")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub(crate) fn validate_wallhaven_root(dir: &Path) -> Result<(), String> {
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
