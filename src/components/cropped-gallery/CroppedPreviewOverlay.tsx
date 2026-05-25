import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Scissors, Trash2 } from 'lucide-react';
import { CropRecord, resolveCroppedImagePath, deleteCropRecord, convertFileSrc } from '../../api';

interface CroppedPreviewOverlayProps {
  previewIndex: number;
  total: number;
  currentRecord: CropRecord;
  onClose: () => void;
  goPrev: () => void;
  goNext: () => void;
  handleImageClick: (e: React.MouseEvent<HTMLImageElement>) => void;
  onDeleteCropRecord?: (deleted: CropRecord) => void;
  onRecrop?: (record: CropRecord) => void;
  onIndexChange: (index: number | null) => void;
}

export function CroppedPreviewOverlay({
  previewIndex,
  total,
  currentRecord,
  onClose,
  goPrev,
  goNext,
  handleImageClick,
  onDeleteCropRecord,
  onRecrop,
  onIndexChange,
}: CroppedPreviewOverlayProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewPath(null);
    setPreviewFailed(false);
    let cancelled = false;
    resolveCroppedImagePath(currentRecord.output_path)
      .then((path) => {
        if (!cancelled) {
          setPreviewPath(path);
          setPreviewFailed(false);
        }
      })
      .catch((err) => {
        console.error('resolveCroppedImagePath failed', err);
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currentRecord]);

  const handleDelete = async () => {
    const ok = confirm('确定删除这张已裁剪图片吗？原图不会删除。');
    if (!ok) return;
    try {
      const deleted = await deleteCropRecord(currentRecord.output_path);
      const nextLength = total - 1;
      if (nextLength === 0) {
        onIndexChange(null);
      } else if (previewIndex >= nextLength) {
        onIndexChange(nextLength - 1);
      }
      onDeleteCropRecord?.(deleted);
    } catch (err: any) {
      alert('删除失败: ' + (err?.message || String(err)));
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 101,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
      onClick={onClose}
    >
      {previewPath ? (
        <img
          src={convertFileSrc(previewPath)}
          alt="preview"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: 8,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            cursor: total <= 1 ? 'default' : 'pointer',
            userSelect: 'none',
          }}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            handleImageClick(e);
          }}
        />
      ) : previewFailed ? (
        <div style={{ color: '#fff', fontSize: 14 }}>文件不存在</div>
      ) : (
        <div style={{ color: '#fff', fontSize: 14 }}>加载中...</div>
      )}

      {/* Nav arrows */}
      {total > 1 && (
        <>
          <button
            className="gallery-nav-btn prev"
            title="上一张 (←)"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            className="gallery-nav-btn next"
            title="下一张 (→)"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
          >
            <ChevronRight size={24} />
          </button>
          {/* Counter */}
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'rgba(255,255,255,0.8)',
              fontSize: 13,
              background: 'rgba(0,0,0,0.4)',
              padding: '4px 12px',
              borderRadius: 12,
            }}
          >
            {previewIndex + 1} / {total}
          </div>
        </>
      )}

      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {onDeleteCropRecord && (
          <button
            className="btn btn-danger"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            <Trash2 size={14} style={{ marginRight: 4 }} />
            删除已裁图片
          </button>
        )}
        {onRecrop && (
          <button
            className="btn btn-accent"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onRecrop(currentRecord);
            }}
          >
            <Scissors size={14} style={{ marginRight: 4 }} />
            重新裁剪
          </button>
        )}
        <button
          className="btn btn-icon"
          style={{ color: '#fff' }}
          onClick={onClose}
          title="关闭预览 (Esc)"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
