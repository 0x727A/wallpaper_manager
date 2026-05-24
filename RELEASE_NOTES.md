# v1.2.0

## 性能优化

- **CroppedGallery 虚拟滚动**：使用 `@tanstack/react-virtual` 实现行级虚拟化，500 张图只渲染视口附近 10~20 行 DOM，根治大列表滚动卡顿
- **缩略图批量 flush**：`pendingThumbsRef` + 50ms debounce，一批缩略图完成最多触发一次 React render
- **缩略图并发限制 4**：队列 + `runningRef` 控制，避免同时百个请求压垮 Rust / image decoder / 磁盘
- **scan_images 异步化**：`WalkDir` 大目录扫描移到 `spawn_blocking`，Windows 慢盘/杀软环境不再冻住 UI
- **移除 gallery 根节点 blur**：`backdropFilter: blur(8px)` 在 Windows WebView 下开销大，已移除
- **ImageGrid 缩略图 prune**：切目录时只删不存在于新图库的路径，不再全量 flush，保留缓存命中率

## 新功能

### 1. 输出模式：硬裁剪 / 遮罩保留
- Inspector 新增输出模式切换按钮
- **硬裁剪**（默认）：现有行为，输出尺寸 = 裁剪框
- **遮罩保留**：输出尺寸 = 原图尺寸，选区外像素涂黑。适合需要保持画布尺寸的下游工作流
- `CropRecord` 新增 `output_mode` 字段记录模式，旧 JSON 自动兼容

### 2. 保存并继续裁剪
- ImageEditor 新增「保存并继续裁剪」按钮
- 点击后保存当前裁剪，**不跳转到下一张图**，自动重置选区，可立即框选同一原图的新区域
- App 侧拆分 `addCropRecord`（只更新记录）与 `advanceAfterCompletedCrop`（只导航），逻辑不复用分叉

### 3. 星级评分（0 ~ 3 星）
- Inspector 新增 ★★★ 选择器，新裁剪可打星
- 已有裁剪列表与 CroppedGallery 缩略图卡片显示星级
- `CropRecord` 新增 `rating` 字段，后端保存前 `clamp(0..3)`，旧 JSON 默认 0

### 4. 像素宽高输入
- Inspector「裁剪坐标」区域的 w/h 改为可编辑 number input
- 输入后实时反算百分比裁剪框，固定比例模式下自动联动并保持左上角不动
- 超界时自动 clamp，拖拽选区后输入值同步更新

## Bug 修复

- **CroppedGallery 内存泄漏**：从 base64 data URL 改为 `ensureCroppedThumbnail` + `convertFileSrc`，state 只存几字节路径字符串，不再累积几百 MB base64
- **RecropCompareModal cleanup race**：`cancelled` 标志移到 `useEffect` 内部同步返回，组件卸载后立即掐断 in-flight promise
- **重裁确认后导航**：`handleConfirmRecrop` 复用 `advanceAfterCompletedCrop`，确认后自动跳到下一张
- **asset scope 403**：setup 时 allow `crop_thumbs` 缓存目录；`resolve_cropped_image_path` 返回前 `allow_file`，输出目录原图实时放行
- **批量裁剪参数缺失**：`run_batch_from_json` 补传 `output_mode`，评级写入时 `min(3)`
- **批量导入丢记录**：删除按 `relative_path` 的 dedupe 逻辑，同一张原图多次裁剪导入不再丢失

## 兼容性

- 旧 `crops.json` 正常读取，缺失 `output_mode` / `rating` 字段时自动使用默认值
