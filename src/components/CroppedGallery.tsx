import { useState, useCallback, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { CropRecord, setCropRecordsRating } from '../api';
import { useCroppedThumbQueue } from './cropped-gallery/useCroppedThumbQueue';
import { CroppedGalleryGrid } from './cropped-gallery/CroppedGalleryGrid';
import { CroppedGalleryTable } from './cropped-gallery/CroppedGalleryTable';
import { CroppedPreviewOverlay } from './cropped-gallery/CroppedPreviewOverlay';
import { SortedRecord } from './cropped-gallery/types';

interface Props {
  records: CropRecord[];
  onClose: () => void;
  onRecrop?: (record: CropRecord) => void;
  onDeleteCropRecord?: (deleted: CropRecord) => void;
  onCropRecordsUpdated?: (records: CropRecord[]) => void;
}

function getRecordFolder(record: CropRecord): string {
  if (!record.relative_path || !record.relative_path.includes('/')) return '__root__';
  const first = record.relative_path.split('/')[0];
  return first || '__root__';
}

export function CroppedGallery({ records, onClose, onRecrop, onDeleteCropRecord, onCropRecordsUpdated }: Props) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [ratingFilter, setRatingFilter] = useState<'all' | 'unrated' | '1' | '2' | '3'>('all');
  const [outputModeFilter, setOutputModeFilter] = useState<'all' | 'crop' | 'mask'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [selectedOutputPaths, setSelectedOutputPaths] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [ratingSaving, setRatingSaving] = useState(false);

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

  useEffect(() => {
    setSelectedOutputPaths((prev) => {
      const visible = new Set(filteredSorted.map((r) => r.output_path));
      const next = new Set([...prev].filter((p) => visible.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredSorted]);

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

  const handleSelectAll = () => {
    setSelectedOutputPaths(new Set(filteredSorted.map((r) => r.output_path)));
  };

  const handleClearSelection = () => {
    setSelectedOutputPaths(new Set());
  };

  const toggleSelect = (outputPath: string) => {
    setSelectedOutputPaths((prev) => {
      const next = new Set(prev);
      if (next.has(outputPath)) next.delete(outputPath);
      else next.add(outputPath);
      return next;
    });
  };

  const handleSetRating = async (rating: number) => {
    if (selectedOutputPaths.size === 0 || ratingSaving) return;
    setRatingSaving(true);
    try {
      const records = await setCropRecordsRating([...selectedOutputPaths], rating);
      onCropRecordsUpdated?.(records);
      setSelectedOutputPaths(new Set());
    } catch (err: any) {
      alert('批量改星级失败: ' + (err?.message || String(err)));
    } finally {
      setRatingSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
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

      {/* Batch toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn${viewMode === 'grid' ? ' btn-accent' : ''}`}
            style={{ fontSize: 13 }}
            onClick={() => setViewMode('grid')}
          >
            网格
          </button>
          <button
            className={`btn${viewMode === 'table' ? ' btn-accent' : ''}`}
            style={{ fontSize: 13 }}
            onClick={() => setViewMode('table')}
          >
            表格
          </button>
        </div>
        <button className="btn" style={{ fontSize: 13 }} onClick={handleSelectAll}>全选</button>
        <button className="btn" style={{ fontSize: 13 }} onClick={handleClearSelection}>清空</button>
        <span style={{ fontSize: 13, color: 'var(--text)' }}>已选 {selectedOutputPaths.size} 张</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={ratingSaving || selectedOutputPaths.size === 0}
            onClick={() => handleSetRating(0)}
          >
            清空星级
          </button>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={ratingSaving || selectedOutputPaths.size === 0}
            onClick={() => handleSetRating(1)}
          >
            1★
          </button>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={ratingSaving || selectedOutputPaths.size === 0}
            onClick={() => handleSetRating(2)}
          >
            2★
          </button>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={ratingSaving || selectedOutputPaths.size === 0}
            onClick={() => handleSetRating(3)}
          >
            3★
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <CroppedGalleryGrid
          sorted={filteredSorted}
          thumbs={thumbs}
          loadThumb={loadThumb}
          onOpenPreview={openPreview}
          onRecrop={onRecrop}
          emptyTitle={emptyTitle}
          selectedOutputPaths={selectedOutputPaths}
          onToggleSelect={toggleSelect}
        />
      ) : (
        <CroppedGalleryTable
          sorted={filteredSorted}
          selectedOutputPaths={selectedOutputPaths}
          onToggleSelect={toggleSelect}
          onOpenPreview={openPreview}
          onRecrop={onRecrop}
          emptyTitle={emptyTitle}
        />
      )}

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
