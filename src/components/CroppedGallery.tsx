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

function getRecordFolder(record: CropRecord): string {
  if (!record.relative_path || !record.relative_path.includes('/')) return '__root__';
  const first = record.relative_path.split('/')[0];
  return first || '__root__';
}

export function CroppedGallery({ records, onClose, onRecrop, onDeleteCropRecord }: Props) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [ratingFilter, setRatingFilter] = useState<'all' | 'unrated' | '1' | '2' | '3'>('all');
  const [outputModeFilter, setOutputModeFilter] = useState<'all' | 'crop' | 'mask'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');

  const { thumbs, loadThumb } = useCroppedThumbQueue(records);

  const sortedAll = useMemo((): SortedRecord[] => {
    return [...records]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((r) => ({
        ...r,
        createdLabel: new Date(r.created_at).toLocaleDateString('zh-CN'),
      }));
  }, [records]);

  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of sortedAll) {
      set.add(getRecordFolder(r));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sortedAll]);

  const filteredSorted = useMemo(() => {
    return sortedAll.filter((r) => {
      if (ratingFilter !== 'all') {
        const rating = r.rating || 0;
        if (ratingFilter === 'unrated') {
          if (rating !== 0) return false;
        } else {
          const min = Number(ratingFilter);
          if (rating < min) return false;
        }
      }

      if (outputModeFilter !== 'all') {
        const mode = r.output_mode || 'crop';
        if (mode !== outputModeFilter) return false;
      }

      if (folderFilter !== 'all') {
        if (getRecordFolder(r) !== folderFilter) return false;
      }

      return true;
    });
  }, [sortedAll, ratingFilter, outputModeFilter, folderFilter]);

  useEffect(() => {
    setPreviewIndex(null);
  }, [ratingFilter, outputModeFilter, folderFilter]);

  const total = filteredSorted.length;
  const currentRecord = previewIndex !== null ? filteredSorted[previewIndex] : null;

  const goPrev = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === 0 ? total - 1 : i - 1;
      loadThumb(filteredSorted[next]);
      return next;
    });
  }, [total, filteredSorted, loadThumb]);

  const goNext = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === total - 1 ? 0 : i + 1;
      loadThumb(filteredSorted[next]);
      return next;
    });
  }, [total, filteredSorted, loadThumb]);

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
    loadThumb(filteredSorted[index]);
  };

  const hasFilters = ratingFilter !== 'all' || outputModeFilter !== 'all' || folderFilter !== 'all';

  const emptyTitle = records.length > 0 && filteredSorted.length === 0
    ? '没有匹配的已裁剪图片'
    : undefined;

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
          已裁剪图片 ({filteredSorted.length} / {records.length})
        </div>
        <button className="btn btn-icon" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          className="btn"
          style={{ fontSize: 13 }}
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value as typeof ratingFilter)}
        >
          <option value="all">全部星级</option>
          <option value="unrated">未评级</option>
          <option value="1">≥1星</option>
          <option value="2">≥2星</option>
          <option value="3">≥3星</option>
        </select>

        <select
          className="btn"
          style={{ fontSize: 13 }}
          value={outputModeFilter}
          onChange={(e) => setOutputModeFilter(e.target.value as typeof outputModeFilter)}
        >
          <option value="all">全部模式</option>
          <option value="crop">硬裁剪</option>
          <option value="mask">遮罩保留</option>
        </select>

        <select
          className="btn"
          style={{ fontSize: 13 }}
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
        >
          <option value="all">全部文件夹</option>
          {folderOptions.map((f) => (
            <option key={f} value={f}>
              {f === '__root__' ? '根目录' : f}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            className="btn"
            style={{ fontSize: 13 }}
            onClick={() => {
              setRatingFilter('all');
              setOutputModeFilter('all');
              setFolderFilter('all');
            }}
          >
            重置
          </button>
        )}
      </div>

      <CroppedGalleryGrid
        sorted={filteredSorted}
        thumbs={thumbs}
        loadThumb={loadThumb}
        onOpenPreview={openPreview}
        onRecrop={onRecrop}
        emptyTitle={emptyTitle}
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
