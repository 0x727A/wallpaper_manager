import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export interface Settings {
  source_dir: string;
  output_dir: string;
}

export interface ImageEntry {
  source_path: string;
  relative_path: string;
  filename: string;
  is_nsfw: boolean;
}

export interface CropRecord {
  source_path: string;
  relative_path: string;
  crop_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  output_path: string;
  output_filename: string;
  ratio_mode: string;
  created_at: string;
  output_mode?: string;
  rating?: number;
}

export interface SaveCropRequest {
  source_path: string;
  crop_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ratio_mode: string;
  output_mode?: string;
  rating?: number;
}

export interface BatchFailure {
  source_path: string;
  reason: string;
}

export interface BatchProgress {
  total: number;
  done: number;
  success: number;
  failed: number;
  current: string;
}

export interface BatchResult {
  success: number;
  failed: number;
  failures: BatchFailure[];
  cancelled: boolean;
  total: number;
  done: number;
}

export interface SkipRecord {
  source_path: string;
  relative_path: string;
  filename: string;
  skipped_at: string;
}

export interface CropPreview {
  data_url: string;
  width: number;
  height: number;
}

export const scanImages = (includeNsfw: boolean): Promise<ImageEntry[]> =>
  invoke('scan_images', { includeNsfw });

export const getSettings = (): Promise<Settings> =>
  invoke('get_settings');

export const setOutputDir = (path: string): Promise<Settings> =>
  invoke('set_output_dir', { path });

export const setSourceDir = (path: string): Promise<Settings> =>
  invoke('set_source_dir', { path });

export const pickOutputDir = (): Promise<string | null> =>
  invoke('pick_output_dir');

export const pickSourceDir = (): Promise<string | null> =>
  invoke('pick_source_dir');

export const pickJsonFile = (): Promise<string | null> =>
  invoke('pick_json_file');

export const ensureThumbnail = (sourcePath: string): Promise<string> =>
  invoke('ensure_thumbnail', { sourcePath });

export interface ResolvedPreview {
  src_path: string;
  src_url: string;
  original_width: number;
  original_height: number;
  preview_width: number;
  preview_height: number;
}

export const resolvePreviewImage = async (sourcePath: string): Promise<ResolvedPreview> => {
  const res: Omit<ResolvedPreview, 'src_url'> = await invoke('resolve_preview_image', { sourcePath });
  return { ...res, src_url: convertFileSrc(res.src_path) };
};

export const saveCrop = (request: SaveCropRequest): Promise<CropRecord> =>
  invoke('save_crop', { request });

export const readCropRecords = (): Promise<CropRecord[]> =>
  invoke('read_crop_records');

export const runBatchFromJson = (jsonPath: string, outputDir: string, jobId: string): Promise<BatchResult> =>
  invoke('run_batch_from_json', { jsonPath, outputDir, jobId });

export const cancelBatch = (jobId: string): Promise<void> =>
  invoke('cancel_batch', { jobId });

export const deleteOriginalImage = (sourcePath: string): Promise<void> =>
  invoke('delete_original_image', { sourcePath });

export const deleteCropRecord = (outputPath: string): Promise<CropRecord> =>
  invoke('delete_crop_record', { outputPath });

export const resolveCroppedImagePath = (outputPath: string): Promise<string> =>
  invoke('resolve_cropped_image_path', { outputPath });

export const ensureCroppedThumbnails = (outputPaths: string[]): Promise<Record<string, string>> =>
  invoke('ensure_cropped_thumbnails', { outputPaths });

export const resolveOriginalForRecord = (record: CropRecord): Promise<ImageEntry> =>
  invoke('resolve_original_for_record', { record });

export const previewCrop = (request: SaveCropRequest): Promise<CropPreview> =>
  invoke('preview_crop', { request });

export interface SaveRecropRequest {
  old_output_path: string;
  crop: SaveCropRequest;
}

export interface SaveRecropResult {
  record: CropRecord;
  warning?: string;
}

export const saveRecrop = (request: SaveRecropRequest): Promise<SaveRecropResult> =>
  invoke('save_recrop', { request });

export const readSkipRecords = (): Promise<SkipRecord[]> =>
  invoke('read_skip_records');

export const skipImage = (sourcePath: string): Promise<SkipRecord> =>
  invoke('skip_image', { sourcePath });

export const unskipImage = (sourcePath: string): Promise<void> =>
  invoke('unskip_image', { sourcePath });

export { convertFileSrc };
