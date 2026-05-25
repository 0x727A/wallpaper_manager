import { useState, useCallback, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { CropRecord } from '../api';
import { useCroppedThumbQueue } from './cropped-gallery/useCroppedThumbQueue';
import { CroppedGalleryGrid } from './cropped-gallery/CroppedGalleryGrid';
import { CroppedPreviewOverlay } from './cropped-gallery/CroppedPreviewOverlay';
import { SortedRecord } from './cropped-gallery/types';

interface Props {
  records: CropRecord[];
  onClose: () => void;
  onRecrop?: (record: CropRecord) => void;
  onDeleteCropRecord?: (deleted: CropRecord) => void;
}

export function CroppedGallery({ records, onClose, onRecrop, onDeleteCropRecord }: Props) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { thumbs, loadThumb } = useCroppedThumbQueue(records);

  const sorted = useMemo((): SortedRecord[] => {
    return [...records]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((r) => ({
        ...r,
        createdLabel: new Date(r.created_at).toLocaleDateString('zh-CN'),
      }));
  }, [records]);

  const total = sorted.length;
  const currentRecord = previewIndex !== null ? sorted[previewIndex] : null;

  const goPrev = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === 0 ? total - 1 : i - 1;
      loadThumb(sorted[next]);
      return next;
    });
  }, [total, sorted, loadThumb]);

  const goNext = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === total - 1 ? 0 : i + 1;
      loadThumb(sorted[next]);
      return next;
    });
  }, [total, sorted, loadThumb]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewIndex((i) => {
          if (i !== null) return null;
          onClose();
          return i;
        });
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrev, goNext, onClose]);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (total <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    if (x < width * 0.4) {
      goPrev();
    } else if (x > width * 0.6) {
      goNext();
    }
  };

  const openPreview = (index: number) => {
    setPreviewIndex(index);
    loadThumb(sorted[index]);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          已裁剪图片 ({records.length})
        </div>
        <button className="btn btn-icon" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      <CroppedGalleryGrid
        sorted={sorted}
        thumbs={thumbs}
        loadThumb={loadThumb}
        onOpenPreview={openPreview}
        onRecrop={onRecrop}
      />

      {previewIndex !== null && currentRecord && (
        <CroppedPreviewOverlay
          previewIndex={previewIndex}
          total={total}
          currentRecord={currentRecord}
          onClose={() => setPreviewIndex(null)}
          goPrev={goPrev}
          goNext={goNext}
          handleImageClick={handleImageClick}
          onDeleteCropRecord={onDeleteCropRecord}
          onRecrop={onRecrop}
          onIndexChange={setPreviewIndex}
        />
      )}
    </div>
  );
}
