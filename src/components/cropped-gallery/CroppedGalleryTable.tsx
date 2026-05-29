import { CropRecord } from '../../api';
import { SortedRecord } from './types';
import { ImageOff } from 'lucide-react';

interface CroppedGalleryTableProps {
  sorted: SortedRecord[];
  selectedOutputPaths: Set<string>;
  onToggleSelect: (outputPath: string) => void;
  onOpenPreview: (index: number) => void;
  onRecrop?: (record: CropRecord) => void;
  emptyTitle?: string;
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
  onRecrop,
  emptyTitle,
}: CroppedGalleryTableProps) {
  if (sorted.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 20,
        }}
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
      }}
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
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>文件夹</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>原图</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>裁剪名</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>星级</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>输出模式</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>尺寸</th>
            <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>创建时间</th>
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
                {onRecrop && (
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: '4px 10px', marginLeft: 8 }}
                    onClick={() => onRecrop(record)}
                  >
                    重裁
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
