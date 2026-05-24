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
}

const PAGE_SIZE = 40;
const CONCURRENCY = 2;

export function ImageGrid({ images, selectedIndex, cropRecords, skipRecords, onSelect, statusFilter, onStatusFilterChange }: Props) {
  const [thumbPaths, setThumbPaths] = useState<Record<string, string>>({});
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
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

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    images.forEach((img, idx) => map.set(img.source_path, idx));
    return map;
  }, [images]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const img of images) {
      const first = img.relative_path.split('/')[0];
      if (first) set.add(first);
    }
    return Array.from(set).sort();
  }, [images]);

  const filtered = useMemo(() => {
    let list = images;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.filename.toLowerCase().includes(q) ||
          i.relative_path.toLowerCase().includes(q)
      );
    }
    if (category !== 'all') {
      list = list.filter((i) => i.relative_path.startsWith(category + '/'));
    }
    return list;
  }, [images, search, category]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, category, images]);

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
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
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
      // 立即 flush 残留 pending，避免 in-flight 结果丢失导致重复请求
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文件名..."
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="all">全部分类</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
            style={{ flex: 1 }}
          >
            <option value="all">全部</option>
            <option value="cropped">已裁剪</option>
            <option value="uncropped">未裁剪</option>
            <option value="skipped">跳过</option>
          </select>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, textAlign: 'right' }}>
          {visibleImages.length} / {filtered.length} / {images.length}
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
          {visibleImages.map((img) => {
            const globalIdx = indexMap.get(img.source_path) ?? -1;
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

        {visibleImages.length < filtered.length && (
          <div style={{ padding: '12px 8px', textAlign: 'center' }}>
            <button
              className="btn"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              加载更多 ({filtered.length - visibleImages.length} 剩余)
            </button>
          </div>
        )}

        {filtered.length === 0 && images.length > 0 && (
          <div className="empty-state" style={{ padding: 40 }}>
            <div>没有匹配的图片</div>
          </div>
        )}
      </div>
    </div>
  );
}
