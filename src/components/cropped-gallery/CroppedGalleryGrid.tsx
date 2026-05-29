import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageOff } from 'lucide-react';
import { ThumbEntry, SortedRecord } from './types';
import { CropRecord } from '../../api';
import { CroppedRecordCard } from './CroppedRecordCard';

const GAP = 16;
const MIN_CARD_WIDTH = 240;
const INFO_HEIGHT = 132;

interface CroppedGalleryGridProps {
  sorted: SortedRecord[];
  thumbs: Record<string, ThumbEntry>;
  loadThumb: (record: CropRecord) => void;
  onOpenPreview: (index: number) => void;
  onRecrop?: (record: CropRecord) => void;
  emptyTitle?: string;
  selectedOutputPaths: Set<string>;
  onToggleSelect: (outputPath: string) => void;
}

export function CroppedGalleryGrid({ sorted, thumbs, loadThumb, onOpenPreview, onRecrop, emptyTitle, selectedOutputPaths, onToggleSelect }: CroppedGalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ cols: 3, cardHeight: 282 });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const c = Math.max(1, Math.floor((w + GAP) / (MIN_CARD_WIDTH + GAP)));
        const cardW = (w - (c - 1) * GAP) / c;
        const imgH = (cardW * 10) / 16;
        const h = Math.ceil(imgH + INFO_HEIGHT);
        setLayout({ cols: c, cardHeight: h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(sorted.length / layout.cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => layout.cardHeight,
    overscan: 3,
    gap: GAP,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const toLoad: CropRecord[] = [];
    for (const row of virtualItems) {
      const start = row.index * layout.cols;
      const end = Math.min(start + layout.cols, sorted.length);
      for (let i = start; i < end; i++) {
        toLoad.push(sorted[i]);
      }
    }
    for (const r of toLoad) {
      loadThumb(r);
    }
  }, [virtualItems, sorted, layout.cols, loadThumb]);

  if (sorted.length === 0) {
    return (
      <div
        ref={parentRef}
        style={{
          flex: 1,
          overflowY: 'auto',
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
      ref={parentRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 20,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualItems.map((virtualRow) => {
          const startIdx = virtualRow.index * layout.cols;
          const endIdx = Math.min(startIdx + layout.cols, sorted.length);
          const rowRecords = sorted.slice(startIdx, endIdx);
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowRecords.map((r, i) => {
                const globalIdx = startIdx + i;
                return (
                  <CroppedRecordCard
                    key={r.output_path}
                    record={r}
                    thumb={thumbs[r.output_path]}
                    onOpenPreview={() => onOpenPreview(globalIdx)}
                    onRecrop={onRecrop}
                    isSelected={selectedOutputPaths.has(r.output_path)}
                    onToggleSelect={() => onToggleSelect(r.output_path)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
