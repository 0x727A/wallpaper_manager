import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, ImageOff, Calendar, Ruler, FileText, Folder, ChevronLeft, ChevronRight, Scissors } from 'lucide-react';
import { CropRecord, readCroppedImageAsDataUrl } from '../api';

interface Props {
  records: CropRecord[];
  onClose: () => void;
  onRecrop?: (record: CropRecord) => void;
}

export function CroppedGallery({ records, onClose, onRecrop }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, { url: string; failed: boolean }>>({});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  const loadThumb = useCallback(async (record: CropRecord) => {
    const key = record.output_path;
    if (loadedRef.current.has(key)) return;
    if (loadingRef.current.has(key)) return;
    loadingRef.current.add(key);
    try {
      const url = await readCroppedImageAsDataUrl(key);
      loadedRef.current.add(key);
      setThumbs((prev) => ({ ...prev, [key]: { url, failed: false } }));
    } catch {
      loadedRef.current.add(key);
      setThumbs((prev) => ({ ...prev, [key]: { url: '', failed: true } }));
    } finally {
      loadingRef.current.delete(key);
    }
  }, []);

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [records]);

  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(idx) && sorted[idx]) {
              loadThumb(sorted[idx]);
            }
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '200px' }
    );

    itemRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sorted, loadThumb]);

  const total = sorted.length;
  const currentRecord = previewIndex !== null ? sorted[previewIndex] : null;
  const currentThumb = currentRecord ? thumbs[currentRecord.output_path] : null;

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
        backdropFilter: 'blur(8px)',
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {sorted.map((r, i) => {
              const thumb = thumbs[r.output_path];
              return (
                <div
                  key={r.output_path}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  data-index={i}
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
                      cursor: thumb?.url ? 'zoom-in' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                    onClick={() => {
                      if (thumb?.url) openPreview(i);
                    }}
                  >
                    {thumb?.url ? (
                      <img
                        src={thumb.url}
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {r.crop_name}
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
                        {new Date(r.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
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
          {currentThumb?.url ? (
            <img
              src={currentThumb.url}
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
          ) : currentThumb?.failed ? (
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
