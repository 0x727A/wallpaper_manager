import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { ImageEntry, ensureThumbnail, CropRecord, SkipRecord, convertFileSrc } from '../api';

export type StatusFilter = 'all' | 'cropped' | 'uncropped' | 'skipped';

interface Props {
  images: ImageEntry[];
  selectedIndex: number;
  cropRecords: Record<string, CropRecord[]>;
  skipRecords: Record<string, SkipRecord>;
  onSelect: (index: number) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: string[];
}

const PAGE_SIZE = 40;
const CONCURRENCY = 2;

interface InlineSelectOption<T extends string> {
  value: T;
  label: string;
}

function InlineSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: InlineSelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <button
        type="button"
        className="select"
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.label ?? value}
        </span>
        <span style={{ marginLeft: 8 }}>⌄</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="btn"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                border: 'none',
                borderRadius: 0,
                background: option.value === value ? 'var(--panel-2)' : 'transparent',
              }}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ImageGrid({
  images,
  selectedIndex,
  cropRecords,
  skipRecords,
  onSelect,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  categories,
}: Props) {
  const [thumbPaths, setThumbPaths] = useState<Record<string, string>>({});
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const pendingThumbsRef = useRef<Record<string, string>>({});
  const pendingFailedRef = useRef<Set<string>>(new Set());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushThumbs = useCallback(() => {
    if (flushTimeoutRef.current !== null) return;
    flushTimeoutRef.current = setTimeout(() => {
      flushTimeoutRef.current = null;
      const pendingPaths = pendingThumbsRef.current;
      const pendingFailed = pendingFailedRef.current;
      if (Object.keys(pendingPaths).length > 0 || pendingFailed.size > 0) {
        setThumbPaths((prev) => {
          const next = { ...prev, ...pendingPaths };
          pendingThumbsRef.current = {};
          return next;
        });
        setFailedThumbs((prev) => {
          const next = new Set(prev);
          for (const k of pendingFailed) {
            next.add(k);
          }
          pendingFailedRef.current = new Set();
          return next;
        });
      }
    }, 50);
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [images]);

  useEffect(() => {
    const validPaths = new Set(images.map((img) => img.source_path));
    setThumbPaths((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (validPaths.has(k)) next[k] = v;
      }
      return next;
    });
    setFailedThumbs((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (validPaths.has(k)) next.add(k);
      }
      return next;
    });
  }, [images]);

  const croppedRel = useMemo(
    () => new Set(Object.values(cropRecords).flat().map((r) => r.relative_path)),
    [cropRecords]
  );

  const skippedRel = useMemo(
    () => new Set(Object.values(skipRecords).map((r) => r.relative_path)),
    [skipRecords]
  );

  const visibleImages = useMemo(
    () => images.slice(0, visibleCount),
    [images, visibleCount]
  );

  useEffect(() => {
    let cancelled = false;

    const missing = visibleImages.filter(
      (img) => !thumbPaths[img.source_path] && !failedThumbs.has(img.source_path)
    );

    if (missing.length === 0) return;

    let idx = 0;

    const startNext = () => {
      if (cancelled || idx >= missing.length) return;
      const img = missing[idx++];
      ensureThumbnail(img.source_path)
        .then((path) => {
          if (!cancelled) {
            pendingThumbsRef.current[img.source_path] = path;
            flushThumbs();
          }
        })
        .catch((err) => {
          console.error('ensureThumbnail failed', img.source_path, err);
          if (!cancelled) {
            pendingFailedRef.current.add(img.source_path);
            flushThumbs();
          }
        })
        .finally(() => {
          startNext();
        });
    };

    for (let i = 0; i < Math.min(CONCURRENCY, missing.length); i++) {
      startNext();
    }

    return () => {
      cancelled = true;
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      const pendingPaths = pendingThumbsRef.current;
      const pendingFailed = pendingFailedRef.current;
      if (Object.keys(pendingPaths).length > 0 || pendingFailed.size > 0) {
        setThumbPaths((prev) => {
          const next = { ...prev, ...pendingPaths };
          pendingThumbsRef.current = {};
          return next;
        });
        setFailedThumbs((prev) => {
          const next = new Set(prev);
          for (const k of pendingFailed) {
            next.add(k);
          }
          pendingFailedRef.current = new Set();
          return next;
        });
      }
    };
  }, [visibleImages]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyThumbLoaded = Object.keys(thumbPaths).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filters */}
      <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div className="search-box" style={{ marginBottom: 8 }}>
          <Search size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索文件名..."
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <InlineSelect
            value={category}
            onChange={onCategoryChange}
            options={[
              { value: 'all', label: '全部分类' },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
          <InlineSelect<StatusFilter>
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={[
              { value: 'all', label: '全部' },
              { value: 'cropped', label: '已裁剪' },
              { value: 'uncropped', label: '未裁剪' },
              { value: 'skipped', label: '跳过' },
            ]}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, textAlign: 'right' }}>
          {visibleImages.length} / {images.length}
        </div>
      </div>

      {/* First-time hint */}
      {images.length > 0 && !anyThumbLoaded && (
        <div style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', background: 'var(--panel)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          首次生成缩略图较慢，第二次会快
        </div>
      )}

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div className="thumb-grid">
          {visibleImages.map((img, idx) => {
            const globalIdx = idx;
            const hasCrops = croppedRel.has(img.relative_path);
            const isSkipped = skippedRel.has(img.relative_path);
            const isSelected = globalIdx === selectedIndex;
            const thumbPath = thumbPaths[img.source_path];
            const failed = failedThumbs.has(img.source_path);

            return (
              <div
                key={img.source_path}
                className={`thumb-item${isSelected ? ' selected' : ''}`}
                onClick={() => onSelect(globalIdx)}
                style={{ opacity: img.is_nsfw ? 0.7 : 1 }}
              >
                {thumbPath ? (
                  <img
                    src={convertFileSrc(thumbPath)}
                    alt={img.filename}
                    style={{ filter: img.is_nsfw ? 'blur(8px)' : undefined }}
                    loading="lazy"
                  />
                ) : failed ? (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', fontSize: 11 }}>
                    失败
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Loader2 size={18} className="spin" style={{ color: 'var(--muted)' }} />
                  </div>
                )}

                {img.is_nsfw && (
                  <div className="nsfw-overlay">
                    <span className="nsfw-tag">NSFW</span>
                  </div>
                )}
                {hasCrops && <div className="cropped-badge">已裁</div>}
                {isSkipped && !hasCrops && <div className="skipped-badge">跳过</div>}
                <div className="filename">{img.filename}</div>
              </div>
            );
          })}
        </div>

        {visibleImages.length < images.length && (
          <div style={{ padding: '12px 8px', textAlign: 'center' }}>
            <button
              className="btn"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              加载更多 ({images.length - visibleImages.length} 剩余)
            </button>
          </div>
        )}

        {images.length === 0 && (
          <div className="empty-state" style={{ padding: 40 }}>
            <div>没有匹配的图片</div>
          </div>
        )}
      </div>
    </div>
  );
}
