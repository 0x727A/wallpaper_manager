# v1.4.3

## 新功能

### 1. 修复已裁记录
- 新增「修复已裁记录」命令，从 `output_dir` 扫描实际裁剪图，自动补全/修正 `crops.json`
- 支持搬家场景：旧 `output_path` 失效时，按 `(relative_path, output_filename)` 稳定匹配并修正为新路径
- `source_path` 同步修正：图库搬家后自动更新原图绝对路径
- async + `spawn_blocking`，上千张图库不冻 UI
- 锁外扫描/匹配/读尺寸，锁内只负责读写 JSON，缩短锁持有时间
- `image::image_dimensions` 替代 `image::open`，只读头信息不解码整图
- 三层匹配防误配：canonical path → relative_parent + filename → filename 全局唯一兜底
- 返回统计：新增、修复路径、跳过、失败样例

### 2. 保存并预览
- Inspector「保存后预览」toggle 改为「保存并预览」一次性按钮
- 删除 `previewAfterSave` 持久化 state 和 `localStorage`，简化心智模型
- 「保存裁剪」保持只保存，「保存并预览」点击后保存并自动弹出预览

## UI 优化

- **Inspector 布局重排**：操作区（保存/跳过/删除）移到面板最底部，sticky footer 样式；按钮高度统一压缩，跳过+删除同排 2 列
- **删除原图二次确认**：首次点击变红底白字，提示「再次点击确认删除」，3 秒超时自动取消
- **星级统一**：裁剪页和预览页都改为单选高亮（只选中当前星级），3 星按钮内部 3 颗 ★ 排成三角形
- **预览页键盘评星**：按数字键 0-3 直接设置星级，不用动鼠标
- **预览页关闭按钮**：加深色半透明底，避免白底白字看不清
- **预览页星级位置**：从右上角移到左下角信息栏上方，不遮挡图片主体
- **表格模式去重裁**：表格视图操作列只保留「预览」，重裁入口仅保留在网格视图和预览弹层

## CI

- workflow run 标题统一：`Release v{version}`，不再跟随 commit message 变化

---

# v1.4.2

## 已裁图库增强

- **筛选支持**：已裁图库新增星级 / 输出模式 / 文件夹筛选，快速定位目标裁剪
- **批量改星级**：已裁记录支持批量选择，一键调整多条记录星级
- **缩略图队列优化**：重构加载队列，避免长期 stuck 在"加载中"
- **重裁防重**：修复重裁时重复点击导致的并发修改报错
- **边界修复**：预览背景误关闭、删除最后一条后露出旧重裁状态等边界问题

---

# v1.4.0

## 性能优化

- **主编辑预览 Base64 → 文件路径**：新增 `resolve_preview_image`，后端只读图片尺寸（不解码整张图），`allow_file` 放行原图；前端用 `convertFileSrc` 直接渲染。内存占用大幅下降，大图切换不再卡顿
- **删除旧 Base64 预览命令**：`read_preview_image` 已无前端调用，完整移除后端命令、`PreviewImage` 类型、`readPreviewImage` API，减少误用
- **删除单条缩略图命令**：`ensure_cropped_thumbnail` 已无人调用，前端全面改用批量版 `ensureCroppedThumbnails`
- **已裁记录字符串精确匹配**：`resolve_cropped_image_path` / `ensure_cropped_thumbnails` 去掉循环内 `fs::canonicalize`，只认 JSON 里的 `output_path` 精确字符串，避免 NAS 上 N 次系统调用
- **编辑器视口自适应**：`ResizeObserver` 监听编辑器尺寸变化，自动重算 `fitZoom`；用户手动缩放时不会被强行覆盖

## 并发安全

- **records_lock 保护 JSON 读写**：`AppState` 新增 `Arc<Mutex<()>>`，所有读改写 crops.json / skipped.json 的流程必须持锁。`save_crop`、`save_recrop`、`delete_crop_record`、`skip_image`、`unskip_image`、`delete_original_image`、`run_batch_from_json` 均已加锁
- **批量导入锁外处理图片**：循环内只做 `create_crop_file`，结束后锁内重新读取 crops、追加新记录、写回。图片处理不阻塞其他记录操作，也不会丢写
- **批量导入失败自动清理**：若最后 `write_crops` 失败，遍历本批新生成的裁剪图并删除，避免留下大量无记录的孤儿文件
- **delete_crop_record 先写后删**：`write_crops` 在 `fs::remove_file` 之前执行。即使删文件失败，JSON 里也不会留下指向已删除文件的幽灵记录

## Bug 修复

- **重裁旧文件删除失败不静默**：`save_recrop` 返回 `SaveRecropResult { record, warning }`，旧文件删除失败时 `warning = Some(...)`，前端弹窗提示用户手动清理。JSON 已成功更新，不再因旧文件删不掉而回滚
- **跳过操作失败不静默**：`handleSkipImage` 添加 try-catch，跳过失败时弹窗提示，连续裁剪锁不被提前清掉
- **delete_original_image 同持 records_lock**：清理 crops + skipped 的读改写全程在锁内，避免与并发 save/delete 竞争

## 内部重构

- `remove_skip_record` 从 `records.rs` 删除，逻辑内联到 `save_crop_blocking` 和 `unskip_image` 的锁内
- `save_recrop_blocking` 分段加锁：锁内读旧记录索引 → 锁外 `create_crop_file` → 锁内验证索引未变后替换写回
- `ImageEditor` 两处 effect 用 `ratioModeRef` / `isRecropActiveRef` 消除 `eslint-disable`，不改变触发条件
- 删除 `paths.rs` 上错位的 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`
- `tempfile = "3"` 从 `[dependencies]` 移到 `[dev-dependencies]`
- 删除未使用的 `BatchPanel.tsx`

---

# v1.2.1

## 性能优化

- **保存/重裁不卡 UI**：`save_crop` / `save_recrop` 的裁图、JSON 读写、旧图删除全部移入 `spawn_blocking`，Tokio worker 线程不再被大图编码阻塞
- **预览加载不卡 UI**：`read_preview_image` / `preview_crop` 的解码、缩放、JPEG 编码、base64 全部移入 `spawn_blocking`
- **批量裁剪后台化**：主循环丢进 `spawn_blocking`，不再阻塞前端；删除批量内的缩略图等待，让图库按可见项懒加载
- **批量裁剪进度 + 取消**：后端 emit `batch-progress-{job_id}` 事件，前端实时显示 `done/total`；支持取消，Windows 慢盘下可随时中止
- **已裁画廊批量验证**：新增 `ensure_cropped_thumbnails` 命令，每批最多 12 张一次 IPC，后端只读一次 `crops.json`，从 N 次降到 ~N/12 次 IPC
- **canonical 索引预建**：批量验证时一次性预建 `HashSet<PathBuf>`，字符串 miss 后从 O(n) canonicalize 降到 O(1) 查找
- **ImageGrid 缩略图 batch flush**：`pendingThumbsRef` + 50ms debounce，一批完成最多触发一次 React render
- **App.tsx useMemo**：`Object.values(cropRecords).flat()` 提取到组件顶部缓存，避免每次 render 重建

## Bug 修复

- **CroppedGallery queue deadlock**：`.finally` 先判断 generation 再清理 ref；cleanup 递增 generation，彻底防止旧 promise 污染新队列
- **后端编译错误**：`run_batch_from_json` / `save_recrop` 中 `MutexGuard` 限制在独立作用域，guard 在 `.await` 前自动释放
- **错误吞掉**：前端 4 处 `.catch(() => ...)` 改为 `.catch((err) => { console.error(...) })`，后端异常可见
- **缩略图缓存跨图库碰撞**：`ensure_thumbnail` 缓存路径加入 `source_dir` hash，不同图库不再共用同一缩略图
- **缩略图缓存精确失效**：sidecar `.meta` 文件记录源文件 `size + mtime`，避免系统时钟调整导致的误失效；删除错误的"原图大小 vs 缩略图大小"比较
- **ImageGrid cleanup 丢结果**：effect cleanup 不再清空 pending ref，而是立即 flush 到 state，避免快速搜索/加载更多时的重复请求
- **App.tsx hooks 规则**：`useMemo` 从条件渲染 JSX 内提取到组件顶部
- **已裁图库 canonical 重复**：`resolve_cropped_image_path` / `ensure_cropped_thumbnail` 去掉循环内重复 `fs::canonicalize(&path)`，字符串优先、canonical fallback 惰性做

## 内部重构

- `generate_crop_thumbnail_sync` 提取为纯 sync 函数，`ensure_cropped_thumbnails` 在 `spawn_blocking` 内直接调用
- `HashSet` 替代 `Vec.contains` 清理 skipped 记录，批量裁剪时从 O(n²) 降到 O(n)
- `BatchResult` 新增 `cancelled` / `total` / `done`，取消时前端显示"已取消 x/y"而非假"完成"
- `SaveCropRequest` / `SaveRecropRequest` 补 `Clone`，方便 `spawn_blocking` 闭包 move

---

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
