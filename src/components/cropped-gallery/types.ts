import { CropRecord } from '../../api';

export interface CroppedGalleryProps {
  records: CropRecord[];
  onClose: () => void;
  onRecrop?: (record: CropRecord) => void;
  onDeleteCropRecord?: (deleted: CropRecord) => void;
}

export interface SortedRecord extends CropRecord {
  createdLabel: string;
}

export interface ThumbEntry {
  path: string;
  failed: boolean;
}

export type TableSortKey =
  | 'created_at'
  | 'rating'
  | 'folder'
  | 'output_mode'
  | 'dimensions'
  | 'relative_path'
  | 'crop_name';

export type SortDirection = 'asc' | 'desc';
