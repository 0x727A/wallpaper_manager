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
