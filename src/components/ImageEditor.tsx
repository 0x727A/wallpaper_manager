import { useState, useEffect, useCallback, useRef } from 'react';
import ReactCrop, { PercentCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { ChevronLeft, ChevronRight, Save, Trash2, ZoomIn, ZoomOut, RotateCcw, Eye } from 'lucide-react';
import { ImageEntry, CropRecord, SaveCropRequest, saveCrop, deleteOriginalImage, readPreviewImage, PreviewImage } from '../api';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const BUTTON_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_FACTOR = 1.08;

const RATIOS = [
  { label: '自由', value: 'free', aspect: undefined as number | undefined },
  { label: '16:9', value: '16:9', aspect: 16 / 9 },
  { label: '16:10', value: '16:10', aspect: 16 / 10 },
  { label: '4:3', value: '4:3', aspect: 4 / 3 },
  { label: '1:1', value: '1:1', aspect: 1 },
  { label: '3:2', value: '3:2', aspect: 3 / 2 },
  { label: '2:3', value: '2:3', aspect: 2 / 3 },
  { label: '21:9', value: '21:9', aspect: 21 / 9 },
];

interface Props {
  image: ImageEntry;
  existingCrops: CropRecord[];
  onSave: (record: CropRecord) => void;
  onDelete: (sourcePath: string) => void;
  onPrev: () => void;
  onNext: () => void;
  settings: { source_dir: string; output_dir: string };
  ratioMode: string;
  onRatioModeChange: (value: string) => void;
  recropTarget?: CropRecord | null;
  onPreviewRecrop?: (request: SaveCropRequest) => void;
  onCancelRecrop?: () => void;
  onSkipImage?: () => void;
}

export function ImageEditor({ image, existingCrops, onSave, onDelete, onSkipImage, onPrev, onNext, settings, ratioMode, onRatioModeChange, recropTarget, onPreviewRecrop, onCancelRecrop }: Props) {
  const [crop, setCrop] = useState<PercentCrop>();
  const [completedCrop, setCompletedCrop] = useState<PercentCrop>();
  const [cropName, setCropName] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const editorViewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);

  type GuideMode = 'none' | 'thirds' | 'diagonal' | 'cross' | 'thirds_diagonal' | 'thirds_cross';
  const [guideMode, setGuideMode] = useState<GuideMode>(() => {
    return (localStorage.getItem('cropGuideMode') as GuideMode) || 'thirds';
  });

  useEffect(() => {
    localStorage.setItem('cropGuideMode', guideMode);
  }, [guideMode]);

  const isRecropActive = recropTarget && recropTarget.relative_path === image.relative_path;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
    setCropName('');
    readPreviewImage(image.source_path)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => { cancelled = true; };
  }, [image.source_path]);

  useEffect(() => {
    if (!preview || !isRecropActive || !recropTarget) return;
    const rt = recropTarget;
    onRatioModeChange(rt.ratio_mode);
    setCropName(rt.crop_name);
    const percentCrop: PercentCrop = {
      unit: '%',
      x: (rt.x / rt.original_width) * 100,
      y: (rt.y / rt.original_height) * 100,
      width: (rt.width / rt.original_width) * 100,
      height: (rt.height / rt.original_height) * 100,
    };
    setCrop(percentCrop);
    setCompletedCrop(percentCrop);
  }, [isRecropActive, recropTarget, preview, onRatioModeChange]);

  const initCrop = useCallback((w: number, h: number, aspect?: number) => {
    let newCrop: PercentCrop;
    if (aspect && aspect > 0) {
      newCrop = centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, aspect, w, h),
        w,
        h
      ) as PercentCrop;
    } else {
      newCrop = centerCrop(
        { unit: '%', x: 5, y: 5, width: 90, height: 90 },
        w,
        h
      ) as PercentCrop;
    }
    setCrop(newCrop);
    setCompletedCrop(newCrop);
  }, []);

  useEffect(() => {
    if (preview) {
      const aspect = RATIOS.find((r) => r.value === ratioMode)?.aspect;
      if (!isRecropActive) {
        initCrop(preview.original_width, preview.original_height, aspect);
      }
    }
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!preview || !editorViewportRef.current) return;

    const viewport = editorViewportRef.current.getBoundingClientRect();
    const availableW = Math.max(1, viewport.width - 32);
    const availableH = Math.max(1, viewport.height - 32);

    const nextFitZoom = Math.min(
      1,
      availableW / preview.preview_width,
      availableH / preview.preview_height
    );

    setFitZoom(nextFitZoom);
    setZoom(nextFitZoom);
  }, [preview]);

  const clampZoom = (value: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!preview || !editorViewportRef.current) return;
    e.preventDefault();

    const viewport = editorViewportRef.current;
    const rect = viewport.getBoundingClientRect();

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = zoom;
    const factor = e.deltaY < 0
      ? (e.shiftKey ? 1.2 : WHEEL_ZOOM_FACTOR)
      : (e.shiftKey ? 1 / 1.2 : 1 / WHEEL_ZOOM_FACTOR);

    const nextZoom = clampZoom(oldZoom * factor);
    if (nextZoom === oldZoom) return;

    const contentX = (viewport.scrollLeft + mouseX) / oldZoom;
    const contentY = (viewport.scrollTop + mouseY) / oldZoom;

    setZoom(nextZoom);

    requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * nextZoom - mouseX;
      viewport.scrollTop = contentY * nextZoom - mouseY;
    });
  };

  const handleRatioChange = (value: string) => {
    onRatioModeChange(value);
    const aspect = RATIOS.find((r) => r.value === value)?.aspect;
    if (preview) {
      initCrop(preview.original_width, preview.original_height, aspect);
    }
  };

  const buildCropRequest = (): SaveCropRequest | null => {
    if (!completedCrop || !preview) return null;
    const px = {
      x: Math.round((completedCrop.x * preview.original_width) / 100),
      y: Math.round((completedCrop.y * preview.original_height) / 100),
      width: Math.round((completedCrop.width * preview.original_width) / 100),
      height: Math.round((completedCrop.height * preview.original_height) / 100),
    };
    if (px.width === 0 || px.height === 0) {
      alert('裁剪区域不能为空');
      return null;
    }
    return {
      source_path: image.source_path,
      crop_name: cropName.trim() || (isRecropActive ? recropTarget!.crop_name : 'crop'),
      ...px,
      ratio_mode: ratioMode,
    };
  };

  const handleSave = async () => {
    const req = buildCropRequest();
    if (!req) return;
    setSaving(true);
    try {
      const record = await saveCrop(req);
      onSave(record);
      setCropName('');
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewRecrop = () => {
    const req = buildCropRequest();
    if (!req) return;
    onPreviewRecrop?.(req);
  };

  const handleDelete = async () => {
    if (!confirm(`确定要删除原图吗？\n${image.filename}\n(将移动到 _deleted 目录)`)) return;
    try {
      await deleteOriginalImage(image.source_path);
      onDelete(image.source_path);
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || String(e)));
    }
  };

  const currentAspect = RATIOS.find((r) => r.value === ratioMode)?.aspect;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Editor toolbar */}
      <div className="editor-toolbar">
        <button className="btn btn-icon" onClick={onPrev} disabled={saving} title="上一张">
          <ChevronLeft size={16} />
        </button>
        <button className="btn btn-icon" onClick={onNext} disabled={saving} title="下一张">
          <ChevronRight size={16} />
        </button>
        <div className="filename" title={`${settings.source_dir}/${image.relative_path}`}>
          {(() => {
            const sourceFolder = settings.source_dir.split(/[\\/]/).filter(Boolean).pop() || '';
            const parts = image.relative_path.split('/');
            const dir = parts.slice(0, -1).join('/');
            const fullDir = sourceFolder ? (dir ? `${sourceFolder}/${dir}` : sourceFolder) : dir;
            return (
              <>
                {fullDir && <span className="file-dir">{fullDir}/</span>}
                <span className="file-name">{image.filename}</span>
              </>
            );
          })()}
        </div>
        <div className="meta">{preview ? `${preview.original_width}×${preview.original_height}` : ''}</div>
        <button className="btn btn-icon btn-sm" onClick={() => setZoom((z) => clampZoom(z - BUTTON_ZOOM_STEP))} title="缩小" disabled={saving}>
          <ZoomOut size={14} />
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-icon btn-sm" onClick={() => setZoom((z) => clampZoom(z + BUTTON_ZOOM_STEP))} title="放大" disabled={saving}>
          <ZoomIn size={14} />
        </button>
        <button className="btn btn-icon btn-sm" onClick={() => setZoom(fitZoom)} title="适应窗口" disabled={saving}>
          <RotateCcw size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Canvas */}
        <div
          ref={editorViewportRef}
          onWheel={handleWheelZoom}
          className="canvas-area"
        >
          {preview ? (
            <div
              className={`zoom-wrapper crop-guide crop-guide-${guideMode}`}
              style={{
                width: `${preview.preview_width * zoom}px`,
                height: `${preview.preview_height * zoom}px`,
              }}
            >
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => {
                  setCrop(percentCrop);
                  setCompletedCrop(percentCrop);
                }}
                onComplete={(_, percentCrop) => {
                  setCrop(percentCrop);
                  setCompletedCrop(percentCrop);
                }}
                aspect={currentAspect}
              >
                <img
                  src={preview.data_url}
                  alt={image.filename}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                  draggable={false}
                />
              </ReactCrop>
            </div>
          ) : (
            <div className="empty-state">
              <div>加载预览中...</div>
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className="inspector">
          <div className="panel-group">
            <div className="panel-group-title">输出目录</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={settings.output_dir}>
              {settings.output_dir || '未设置'}
            </div>
          </div>

          <div className="panel-group">
            <div className="panel-group-title">裁剪名称</div>
            <input
              className="input"
              type="text"
              value={cropName}
              onChange={(e) => setCropName(e.target.value)}
              placeholder="例如: 16_9_banner"
            />
          </div>

          <div className="panel-group">
            <div className="panel-group-title">比例</div>
            <div className="ratio-grid">
              {RATIOS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`ratio-btn${ratioMode === r.value ? ' active' : ''}`}
                  onClick={() => handleRatioChange(r.value)}
                  disabled={saving}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-group">
            <div className="panel-group-title">辅助线</div>
            <select
              className="select"
              value={guideMode}
              onChange={(e) => setGuideMode(e.target.value as GuideMode)}
            >
              <option value="none">无</option>
              <option value="thirds">三分线</option>
              <option value="diagonal">对角线</option>
              <option value="cross">十字线</option>
              <option value="thirds_diagonal">三分线 + 对角线</option>
              <option value="thirds_cross">三分线 + 十字线</option>
            </select>
          </div>

          <div className="panel-group">
            <div className="panel-group-title">裁剪坐标</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace', lineHeight: 1.6 }}>
              {completedCrop && preview ? (
                <>
                  x: {Math.round((completedCrop.x * preview.original_width) / 100)}<br />
                  y: {Math.round((completedCrop.y * preview.original_height) / 100)}<br />
                  w: {Math.round((completedCrop.width * preview.original_width) / 100)}<br />
                  h: {Math.round((completedCrop.height * preview.original_height) / 100)}
                </>
              ) : (
                '未选择'
              )}
            </div>
          </div>

          <div className="panel-group">
            {isRecropActive ? (
              <>
                <button
                  className="btn btn-accent"
                  onClick={handlePreviewRecrop}
                  disabled={saving || !completedCrop}
                  style={{ width: '100%', marginBottom: 8 }}
                >
                  <Eye size={14} />
                  预览重裁
                </button>
                <button
                  className="btn"
                  onClick={onCancelRecrop}
                  disabled={saving}
                  style={{ width: '100%', marginBottom: 8 }}
                >
                  取消重裁
                </button>
              </>
            ) : (
              <button
                className="btn btn-success"
                onClick={handleSave}
                disabled={saving || !completedCrop}
                style={{ width: '100%', marginBottom: 8 }}
              >
                <Save size={14} />
                {saving ? '保存中...' : '保存裁剪'}
              </button>
            )}

            {!isRecropActive && (
              <button
                className="btn"
                onClick={onSkipImage}
                disabled={saving}
                style={{ width: '100%', marginBottom: 8 }}
              >
                跳过
              </button>
            )}

            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={saving}
              style={{ width: '100%' }}
            >
              <Trash2 size={14} />
              删除原图
            </button>
          </div>

          <div className="panel-group">
            <div className="panel-group-title">已有裁剪 ({existingCrops.length})</div>
            {existingCrops.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>无</div>
            )}
            {existingCrops.map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--text)' }}>{c.crop_name}</div>
                <div>{c.width}×{c.height} ({c.ratio_mode})</div>
                <div style={{ color: 'var(--muted-2)', fontSize: 10 }}>{c.output_filename}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
