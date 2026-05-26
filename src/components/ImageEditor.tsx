import { useState, useEffect, useCallback, useRef } from 'react';
import { PercentCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import {
  ImageEntry,
  CropRecord,
  SaveCropRequest,
  saveCrop,
  deleteOriginalImage,
  PreviewImage,
} from '../api';
import { getCachedPreview, loadPreview } from '../utils/previewCache';
import { ImageEditorToolbar } from './image-editor/ImageEditorToolbar';
import { CropCanvas } from './image-editor/CropCanvas';
import { ImageEditorInspector } from './image-editor/ImageEditorInspector';
import { RATIOS, MIN_ZOOM, MAX_ZOOM, WHEEL_ZOOM_FACTOR } from './image-editor/constants';
import { GuideMode, OutputMode, Rating } from './image-editor/types';

interface Props {
  image: ImageEntry;
  existingCrops: CropRecord[];
  onSave: (record: CropRecord) => void;
  onSaveAndContinue?: (record: CropRecord) => void;
  onDelete: (sourcePath: string) => void;
  onPrev: () => void;
  onNext: () => void;
  settings: { source_dir: string; output_dir: string };
  ratioMode: string;
  onRatioModeChange: (value: string) => void;
  recropTarget?: CropRecord | null;
  onPreviewRecrop?: (request: SaveCropRequest) => void;
  onCancelRecrop?: () => void;
  onConfirmRecrop?: (request: SaveCropRequest) => void;
  onSkipImage?: () => void;
}

export function ImageEditor({
  image,
  existingCrops,
  onSave,
  onSaveAndContinue,
  onDelete,
  onSkipImage,
  onPrev,
  onNext,
  settings,
  ratioMode,
  onRatioModeChange,
  recropTarget,
  onPreviewRecrop,
  onCancelRecrop,
  onConfirmRecrop,
}: Props) {
  const [crop, setCrop] = useState<PercentCrop>();
  const [completedCrop, setCompletedCrop] = useState<PercentCrop>();
  const [cropName, setCropName] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const editorViewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);

  const [guideMode, setGuideMode] = useState<GuideMode>(() => {
    return (localStorage.getItem('cropGuideMode') as GuideMode) || 'thirds';
  });
  const [outputMode, setOutputMode] = useState<OutputMode>('crop');
  const [rating, setRating] = useState<Rating>(0);

  useEffect(() => {
    localStorage.setItem('cropGuideMode', guideMode);
  }, [guideMode]);

  const isRecropActive = recropTarget && recropTarget.relative_path === image.relative_path;

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedPreview(image.source_path);

    setCrop(undefined);
    setCompletedCrop(undefined);
    setCropName('');

    if (cached) {
      setPreview(cached);
      // 缓存命中时直接初始化裁剪框，避免 preview 引用相同导致 effect 不触发
      const aspect = RATIOS.find((r) => r.value === ratioMode)?.aspect;
      if (!isRecropActive) {
        initCrop(cached.original_width, cached.original_height, aspect);
      }
    } else {
      setPreview(null);
      loadPreview(image.source_path)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
        })
        .catch((err) => {
          console.error('readPreviewImage failed', err);
          if (!cancelled) setPreview(null);
        });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.source_path]);

  useEffect(() => {
    if (!preview || !isRecropActive || !recropTarget) return;
    const rt = recropTarget;
    onRatioModeChange(rt.ratio_mode);
    setCropName(rt.crop_name);
    setOutputMode((rt.output_mode as OutputMode) ?? 'crop');
    setRating(Math.min(3, Math.max(0, rt.rating ?? 0)) as Rating);
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

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!preview || !editorViewportRef.current) return;
    e.preventDefault();

    const viewport = editorViewportRef.current;
    const rect = viewport.getBoundingClientRect();

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = zoom;
    const factor =
      e.deltaY < 0
        ? e.shiftKey
          ? 1.2
          : WHEEL_ZOOM_FACTOR
        : e.shiftKey
          ? 1 / 1.2
          : 1 / WHEEL_ZOOM_FACTOR;

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
      output_mode: outputMode,
      rating,
    };
  };

  const doSave = async (req: SaveCropRequest) => {
    setSaving(true);
    try {
      const record = await saveCrop(req);
      return record;
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const req = buildCropRequest();
    if (!req) return;
    const record = await doSave(req);
    if (record) {
      onSave(record);
      setCropName('');
    }
  };

  const handleSaveAndContinue = async () => {
    const req = buildCropRequest();
    if (!req) return;
    const record = await doSave(req);
    if (record && onSaveAndContinue) {
      onSaveAndContinue(record);
      setCropName('');
      const aspect = RATIOS.find((r) => r.value === ratioMode)?.aspect;
      if (preview) {
        initCrop(preview.original_width, preview.original_height, aspect);
      }
    }
  };

  const applyPixelCrop = (px: { x: number; y: number; width: number; height: number }) => {
    if (!preview) return;
    const newCrop: PercentCrop = {
      unit: '%',
      x: (px.x / preview.original_width) * 100,
      y: (px.y / preview.original_height) * 100,
      width: (px.width / preview.original_width) * 100,
      height: (px.height / preview.original_height) * 100,
    };
    setCrop(newCrop);
    setCompletedCrop(newCrop);
  };

  const currentAspect = RATIOS.find((r) => r.value === ratioMode)?.aspect;

  const handleWidthChange = (val: number) => {
    if (!preview || !completedCrop || Number.isNaN(val) || val < 1) return;
    const x = Math.round((completedCrop.x * preview.original_width) / 100);
    const y = Math.round((completedCrop.y * preview.original_height) / 100);
    let w = Math.min(val, preview.original_width - x);
    let h = currentAspect
      ? Math.round(w / currentAspect)
      : Math.round((completedCrop.height * preview.original_height) / 100);
    if (h > preview.original_height - y) {
      h = preview.original_height - y;
      if (currentAspect) {
        w = Math.round(h * currentAspect);
      }
    }
    h = Math.max(1, h);
    w = Math.max(1, w);
    applyPixelCrop({ x, y, width: w, height: h });
  };

  const handleHeightChange = (val: number) => {
    if (!preview || !completedCrop || Number.isNaN(val) || val < 1) return;
    const x = Math.round((completedCrop.x * preview.original_width) / 100);
    const y = Math.round((completedCrop.y * preview.original_height) / 100);
    let h = Math.min(val, preview.original_height - y);
    let w = currentAspect
      ? Math.round(h * currentAspect)
      : Math.round((completedCrop.width * preview.original_width) / 100);
    if (w > preview.original_width - x) {
      w = preview.original_width - x;
      if (currentAspect) {
        h = Math.round(w / currentAspect);
      }
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    applyPixelCrop({ x, y, width: w, height: h });
  };

  const handlePreviewRecrop = () => {
    const req = buildCropRequest();
    if (!req) return;
    onPreviewRecrop?.(req);
  };

  const handleConfirmRecrop = () => {
    const req = buildCropRequest();
    if (!req) return;
    onConfirmRecrop?.(req);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ImageEditorToolbar
        onPrev={onPrev}
        onNext={onNext}
        saving={saving}
        sourceDir={settings.source_dir}
        relativePath={image.relative_path}
        filename={image.filename}
        dimensions={preview ? `${preview.original_width}×${preview.original_height}` : ''}
        zoom={zoom}
        fitZoom={fitZoom}
        onZoomChange={setZoom}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <CropCanvas
          preview={preview}
          imageFilename={image.filename}
          crop={crop}
          onCropChange={setCrop}
          onCropComplete={setCompletedCrop}
          currentAspect={currentAspect}
          guideMode={guideMode}
          zoom={zoom}
          onWheelZoom={handleWheelZoom}
          editorViewportRef={editorViewportRef}
          outputMode={outputMode}
        />

        <ImageEditorInspector
          settings={settings}
          cropName={cropName}
          onCropNameChange={setCropName}
          ratioMode={ratioMode}
          onRatioChange={handleRatioChange}
          outputMode={outputMode}
          onOutputModeChange={setOutputMode}
          rating={rating}
          onRatingChange={setRating}
          guideMode={guideMode}
          onGuideModeChange={setGuideMode}
          completedCrop={completedCrop}
          preview={preview}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
          isRecropActive={!!isRecropActive}
          saving={saving}
          onPreviewRecrop={handlePreviewRecrop}
          onCancelRecrop={onCancelRecrop}
          onConfirmRecrop={handleConfirmRecrop}
          onSave={handleSave}
          onSaveAndContinue={onSaveAndContinue ? handleSaveAndContinue : undefined}
          onSkipImage={onSkipImage}
          onDelete={handleDelete}
          existingCrops={existingCrops}
        />
      </div>
    </div>
  );
}
