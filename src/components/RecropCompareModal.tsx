import { useState, useEffect, useCallback } from 'react';
import { X, Check, ArrowLeft, Trash2 } from 'lucide-react';
import { CropRecord, CropPreview, readCroppedImageAsDataUrl } from '../api';

interface Props {
  oldRecord: CropRecord;
  preview: CropPreview;
  onConfirm: () => void;
  onAdjust: () => void;
  onCancel: () => void;
}

export function RecropCompareModal({ oldRecord, preview, onConfirm, onAdjust, onCancel }: Props) {
  const [oldUrl, setOldUrl] = useState<string | null>(null);
  const [oldFailed, setOldFailed] = useState(false);

  const loadOld = useCallback(async () => {
    try {
      const url = await readCroppedImageAsDataUrl(oldRecord.output_path);
      setOldUrl(url);
    } catch {
      setOldFailed(true);
    }
  }, [oldRecord.output_path]);

  useEffect(() => {
    loadOld();
  }, [loadOld]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
      }}
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
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          对比裁剪效果
        </div>
        <button className="btn btn-icon" onClick={onAdjust} title="关闭">
          <X size={16} />
        </button>
      </div>

      {/* Comparison area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          padding: 20,
          gap: 20,
        }}
      >
        {/* Old crop */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, textAlign: 'center' }}>
            旧裁剪 · {oldRecord.width}×{oldRecord.height}
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--canvas)',
              borderRadius: 8,
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {oldUrl ? (
              <img
                src={oldUrl}
                alt="旧裁剪"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : oldFailed ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>旧裁剪图不存在</div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>加载中...</div>
            )}
          </div>
        </div>

        {/* New preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, textAlign: 'center' }}>
            新裁剪预览 · {preview.width}×{preview.height}
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--canvas)',
              borderRadius: 8,
              border: '1px solid var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <img
              src={preview.data_url}
              alt="新裁剪预览"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '16px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
        }}
      >
        <button className="btn" onClick={onCancel}>
          <Trash2 size={14} style={{ marginRight: 4 }} />
          取消重裁
        </button>
        <button className="btn btn-accent" onClick={onAdjust}>
          <ArrowLeft size={14} style={{ marginRight: 4 }} />
          继续调整
        </button>
        <button className="btn btn-success" onClick={onConfirm}>
          <Check size={14} style={{ marginRight: 4 }} />
          使用新裁剪
        </button>
      </div>
    </div>
  );
}
