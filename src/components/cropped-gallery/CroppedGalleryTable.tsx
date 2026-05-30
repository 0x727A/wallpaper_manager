import { CropRecord } from '../../api';
import { SortedRecord, TableSortKey } from './types';
import { ImageOff } from 'lucide-react';

interface CroppedGalleryTableProps {
  sorted: SortedRecord[];
  selectedOutputPaths: Set<string>;
  onToggleSelect: (outputPath: string) => void;
  onOpenPreview: (index: number) => void;
  emptyTitle?: string;
  sortKey: TableSortKey;
  sortDirection: 'asc' | 'desc';
  onSortChange: (key: TableSortKey) => void;
}

function getRecordFolder(record: CropRecord): string {
  if (!record.relative_path || !record.relative_path.includes('/')) return '根目录';
  const first = record.relative_path.split('/')[0];
  return first || '根目录';
}

export function CroppedGalleryTable({
  sorted,
  selectedOutputPaths,
  onToggleSelect,
  onOpenPreview,
  emptyTitle,
  sortKey,
  sortDirection,
  onSortChange,
}: CroppedGalleryTableProps) {
  if (sorted.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 20,
          background: 'var(--panel)',
          color: 'var(--text)',
        }}
        data-cropped-gallery-scroll
        onClick={(e) => e.stopPropagation()}
      >
        <div className="empty-state" style={{ height: '60vh' }}>
          <ImageOff size={48} style={{ opacity: 0.3 }} />
          <div className="empty-state-title">{emptyTitle ?? '还没有已裁剪图片'}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: 20,
        background: 'var(--panel)',
        color: 'var(--text)',
      }}
      data-cropped-gallery-scroll
      onClick={(e) => e.stopPropagation()}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          color: 'var(--text)',
          background: 'var(--panel)',
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--panel-2)',
            color: 'var(--text)',
            zIndex: 1,
          }}
        >
          <tr>
            <th style={{ width: 56, padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>序号</th>
            <th style={{ width: 40, padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }} />
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('folder')}
                title="按文件夹排序"
              >
                文件夹{sortKey === 'folder' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('relative_path')}
                title="按原图排序"
              >
                原图{sortKey === 'relative_path' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('crop_name')}
                title="按裁剪名排序"
              >
                裁剪名{sortKey === 'crop_name' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('rating')}
                title="按星级排序"
              >
                星级{sortKey === 'rating' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('output_mode')}
                title="按输出模式排序"
              >
                输出模式{sortKey === 'output_mode' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('dimensions')}
                title="按尺寸排序"
              >
                尺寸{sortKey === 'dimensions' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <button
                className="btn"
                style={{ fontSize: 13, padding: 0, border: 'none', background: 'transparent' }}
                onClick={() => onSortChange('created_at')}
                title="按创建时间排序"
              >
                创建时间{sortKey === 'created_at' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((record, index) => (
            <tr
              key={record.output_path}
              style={{
                borderBottom: '1px solid var(--border)',
                background: index % 2 === 0 ? 'var(--panel)' : 'var(--panel-2)',
              }}
            >
              <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {index + 1}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selectedOutputPaths.has(record.output_path)}
                  onChange={() => onToggleSelect(record.output_path)}
                  style={{
                    width: 18,
                    height: 18,
                    accentColor: 'var(--accent)',
                    cursor: 'pointer',
                  }}
                />
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={getRecordFolder(record)}
              >
                {getRecordFolder(record)}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={record.relative_path}
              >
                {record.relative_path}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={record.crop_name}
              >
                {record.crop_name}
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                {(record.rating || 0) > 0 ? (
                  '★'.repeat(record.rating || 0)
                ) : (
                  <span style={{ color: 'var(--muted)' }}>未评级</span>
                )}
              </td>
              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                {record.output_mode === 'mask' ? '遮罩保留' : '硬裁剪'}
              </td>
              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                {record.width}×{record.height}
              </td>
              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                {record.createdLabel}
              </td>
              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => onOpenPreview(index)}
                >
                  预览
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
