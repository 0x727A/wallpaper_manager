import { convertFileSrc } from '../../api';
import { Calendar, FileText, Folder, Ruler, Scissors } from 'lucide-react';
import { SortedRecord, ThumbEntry } from './types';

interface CroppedRecordCardProps {
  record: SortedRecord;
  thumb: ThumbEntry | undefined;
  onOpenPreview: () => void;
  onRecrop?: (record: SortedRecord) => void;
}

export function CroppedRecordCard({ record, thumb, onOpenPreview, onRecrop }: CroppedRecordCardProps) {
  return (
    <div
      style={{
        background: 'var(--panel-2)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          aspectRatio: '16 / 10',
          background: 'var(--canvas)',
          cursor: thumb?.path ? 'zoom-in' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        onClick={() => {
          if (thumb?.path) onOpenPreview();
        }}
      >
        {thumb?.path ? (
          <img
            src={convertFileSrc(thumb.path)}
            alt={record.crop_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : thumb?.failed ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>文件不存在</div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>加载中...</div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {onRecrop && (
          <button
            className="btn btn-accent"
            style={{ width: '100%', fontSize: 13, marginBottom: 2 }}
            onClick={(e) => {
              e.stopPropagation();
              onRecrop(record);
            }}
          >
            <Scissors size={13} style={{ marginRight: 4 }} />
            重新裁剪此图
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{record.crop_name}</span>
          {(record.rating || 0) > 0 && (
            <span style={{ color: 'var(--accent)', fontSize: 11 }}>{'★'.repeat(record.rating || 0)}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Folder size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {record.relative_path}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileText size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {record.output_filename}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Ruler size={10} />
            {record.width}×{record.height}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Calendar size={10} />
            {record.createdLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
