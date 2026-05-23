# Wallhaven 图片裁剪记录器

一个基于 Tauri v2 + React 的桌面应用，用于批量管理壁纸图库的裁剪记录。

## 功能

- **图库扫描**：扫描 Wallhaven 风格图库，支持 SFW/NSFW/XXX 分类，自动检测 NSFW 内容
- **裁剪编辑器**：可视化框选裁剪，支持 8 种常用比例，滚轮缩放，实时预览
- **裁剪记录**：每张原图可保存多条裁剪记录，自动写入图库根目录的 `crops.json`
- **已裁剪管理**：网格展示所有已裁剪图片，支持大图预览、左右导航、重新裁剪
- **批量处理**：支持从 JSON 导入裁剪记录并自动批量裁剪
- **原图管理**：支持删除原图（移动到 `_deleted` 回收目录）
- **深色模式**：自动跟随系统深浅色主题

## 技术栈

- **后端**：Rust 1.95 + Tauri v2
- **前端**：React 19 + TypeScript + Vite
- **图片处理**：`image` crate（JPEG/PNG）
- **跨平台**：macOS / Windows / Linux（目前主要在 macOS 开发，Windows 适配中）

## 运行

```bash
npm install
cd src-tauri && cargo check && cd ..
npm run web:build
npm run tauri dev
```

## 构建

```bash
npm run web:build
cd src-tauri && cargo build --release
```

## 计划

- [x] macOS 运行
- [x] 核心裁剪功能
- [x] 已裁剪画廊 + 重新裁剪
- [ ] Windows 安装包（`.msi`）
- [ ] Linux 支持
