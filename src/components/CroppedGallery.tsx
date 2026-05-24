import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X, ImageOff, Calendar, Ruler, FileText, Folder, ChevronLeft, ChevronRight, Scissors, Trash2 } from 'lucide-react';
import { CropRecord, resolveCroppedImagePath, ensureCroppedThumbnail, deleteCropRecord, convertFileSrc } from '../api';

interface Props {
  records: CropRecord[];
  onClose: () => void;
  onRecrop?: (record: CropRecord) => void;
  onDeleteCropRecord?: (deleted: CropRecord) => void;
}

interface SortedRecord extends CropRecord {
  createdLabel: string;
}

const GAP = 16;
const MIN_CARD_WIDTH = 240;
const INFO_HEIGHT = 132;
const CONCURRENCY = 4;

export function CroppedGallery({ records, onClose, onRecrop, onDeleteCropRecord }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, { path: string; failed: boolean }>>({});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Set<string>>(new Set());
  const pendingThumbsRef = useRef<Record<string, { path: string; failed: boolean }>>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<CropRecord[]>([]);
  const runningRef = useRef(0);
  const disposedRef = useRef(false);
  const generationRef = useRef(0);

  const flushThumbs = useCallback(() => {
    if (disposedRef.current) return;
    if (flushTimeoutRef.current !== null) return;
    flushTimeoutRef.current = setTimeout(() => {
      flushTimeoutRef.current = null;
      if (disposedRef.current) return;
      if (Object.keys(pendingThumbsRef.current).length > 0) {
        setThumbs((prev) => ({ ...prev, ...pendingThumbsRef.current }));
        pendingThumbsRef.current = {};
      }
    }, 50);
  }, []);

  const scheduleLoad = useCallback(() => {
    const gen = generationRef.current;
    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const record = queueRef.current.shift()!;
      const key = record.output_path;
      queuedRef.current.delete(key);
      if (loadedRef.current.has(key) || loadingRef.current.has(key)) {
        continue;
      }
      runningRef.current++;
      loadingRef.current.add(key);
      ensureCroppedThumbnail(key)
        .then((path) => {
          if (generationRef.current !== gen) return;
          loadedRef.current.add(key);
          pendingThumbsRef.current[key] = { path, failed: false };
        })
        .catch((err) => {
          console.error('ensureCroppedThumbnail failed', key, err);
          if (generationRef.current !== gen) return;
          loadedRef.current.add(key);
          pendingThumbsRef.current[key] = { path: '', failed: true };
        })
        .finally(() => {
          if (generationRef.current !== gen) return;
          loadingRef.current.delete(key);
          runningRef.current = Math.max(0, runningRef.current - 1);
          flushThumbs();
          scheduleLoad();
        });
    }
  }, [flushThumbs]);

  const loadThumb = useCallback((record: CropRecord) => {
    const key = record.output_path;
    if (loadedRef.current.has(key) || loadingRef.current.has(key) || queuedRef.current.has(key)) return;
    queuedRef.current.add(key);
    queueRef.current.push(record);
    scheduleLoad();
  }, [scheduleLoad]);

  const sorted = useMemo((): SortedRecord[] => {
    return [...records]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((r) => ({
        ...r,
        createdLabel: new Date(r.created_at).toLocaleDateString('zh-CN'),
      }));
  }, [records]);

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
        const imgH = cardW * 10 / 16;
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
    generationRef.current++;
    disposedRef.current = false;
    return () => {
      generationRef.current++;
      disposedRef.current = true;
      setThumbs({});
      loadedRef.current.clear();
      loadingRef.current.clear();
      queuedRef.current.clear();
      queueRef.current = [];
      runningRef.current = 0;
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      pendingThumbsRef.current = {};
    };
  }, []);

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

  const total = sorted.length;
  const currentRecord = previewIndex !== null ? sorted[previewIndex] : null;

  useEffect(() => {
    setPreviewPath(null);
    setPreviewFailed(false);
    if (!currentRecord) return;
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

  const goPrev = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === 0 ? total - 1 : i - 1;
      loadThumb(sorted[next]);
      return next;
    });
  }, [total, sorted, loadThumb]);

  const goNext = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null || total <= 1) return i;
      const next = i === total - 1 ? 0 : i + 1;
      loadThumb(sorted[next]);
      return next;
    });
  }, [total, sorted, loadThumb]);

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
    loadThumb(sorted[index]);
  };

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
          已裁剪图片 ({records.length})
        </div>
        <button className="btn btn-icon" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      {/* Grid */}
      <div
        ref={parentRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {sorted.length === 0 ? (
          <div className="empty-state" style={{ height: '60vh' }}>
            <ImageOff size={48} style={{ opacity: 0.3 }} />
            <div className="empty-state-title">还没有已裁剪图片</div>
          </div>
        ) : (
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
                    const thumb = thumbs[r.output_path];
                    return (
                      <div
                        key={r.output_path}
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
                            if (thumb?.path) openPreview(globalIdx);
                          }}
                        >
                          {thumb?.path ? (
                            <img
                              src={convertFileSrc(thumb.path)}
                              alt={r.crop_name}
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
                                onRecrop(r);
                              }}
                            >
                              <Scissors size={13} style={{ marginRight: 4 }} />
                              重新裁剪此图
                            </button>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.crop_name}</span>
                            {(r.rating || 0) > 0 && (
                              <span style={{ color: 'var(--accent)', fontSize: 11 }}>{'★'.repeat(r.rating || 0)}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Folder size={10} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.relative_path}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <FileText size={10} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.output_filename}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Ruler size={10} />
                              {r.width}×{r.height}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Calendar size={10} />
                              {r.createdLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full preview overlay */}
      {previewIndex !== null && (
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
          onClick={() => setPreviewIndex(null)}
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
                {previewIndex! + 1} / {total}
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
            {onDeleteCropRecord && currentRecord && (
              <button
                className="btn btn-danger"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!currentRecord) return;
                  const ok = confirm('确定删除这张已裁剪图片吗？原图不会删除。');
                  if (!ok) return;
                  try {
                    const deleted = await deleteCropRecord(currentRecord.output_path);
                    const nextLength = sorted.length - 1;
                    if (nextLength === 0) {
                      setPreviewIndex(null);
                    } else if (previewIndex !== null && previewIndex >= nextLength) {
                      setPreviewIndex(nextLength - 1);
                    }
                    onDeleteCropRecord(deleted);
                  } catch (err: any) {
                    alert('删除失败: ' + (err?.message || String(err)));
                  }
                }}
              >
                <Trash2 size={14} style={{ marginRight: 4 }} />
                删除已裁图片
              </button>
            )}
            {onRecrop && currentRecord && (
              <button
                className="btn btn-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewIndex(null);
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
              onClick={() => setPreviewIndex(null)}
              title="关闭预览 (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
