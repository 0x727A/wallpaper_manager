import ReactCrop, { PercentCrop } from 'react-image-crop';
import { useEffect, useRef, useState } from 'react';
import { GuideMode, OutputMode } from './types';

interface CropCanvasProps {
  preview: { data_url: string; preview_width: number; preview_height: number } | null;
  imageFilename: string;
  crop: PercentCrop | undefined;
  onCropChange: (crop: PercentCrop) => void;
  onCropComplete: (crop: PercentCrop) => void;
  currentAspect: number | undefined;
  guideMode: GuideMode;
  zoom: number;
  onWheelZoom: (e: React.WheelEvent<HTMLDivElement>) => void;
  editorViewportRef: React.RefObject<HTMLDivElement | null>;
  outputMode: OutputMode;
}

export function CropCanvas({
  preview,
  imageFilename,
  crop,
  onCropChange,
  onCropComplete,
  currentAspect,
  guideMode,
  zoom,
  onWheelZoom,
  editorViewportRef,
  outputMode,
}: CropCanvasProps) {
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  useEffect(() => {
    const stopPan = () => {
      panRef.current.active = false;
      setIsPanning(false);
    };
    window.addEventListener('mouseup', stopPan);
    window.addEventListener('blur', stopPan);
    return () => {
      window.removeEventListener('mouseup', stopPan);
      window.removeEventListener('blur', stopPan);
    };
  }, []);

  const showMask = outputMode === 'mask' && crop && crop.unit === '%';
  const mx = showMask ? Math.max(0, Math.min(100, crop.x)) : 0;
  const my = showMask ? Math.max(0, Math.min(100, crop.y)) : 0;
  const mw = showMask ? Math.max(0, Math.min(100 - mx, crop.width)) : 0;
  const mh = showMask ? Math.max(0, Math.min(100 - my, crop.height)) : 0;

  return (
    <div
      ref={editorViewportRef}
      onWheel={onWheelZoom}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        if (e.button !== 2 || !editorViewportRef.current) return;
        e.preventDefault();
        const viewport = editorViewportRef.current;
        panRef.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop,
        };
        setIsPanning(true);
      }}
      onMouseMove={(e) => {
        if (!panRef.current.active || !editorViewportRef.current) return;
        e.preventDefault();
        const viewport = editorViewportRef.current;
        viewport.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.startX);
        viewport.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.startY);
      }}
      onMouseUp={(e) => {
        if (e.button === 2) {
          panRef.current.active = false;
          setIsPanning(false);
        }
      }}
      onMouseLeave={() => {
        panRef.current.active = false;
        setIsPanning(false);
      }}
      className="canvas-area"
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      {preview ? (
        <div
          className={`zoom-wrapper crop-guide crop-guide-${guideMode}`}
          style={{
            width: `${preview.preview_width * zoom}px`,
            height: `${preview.preview_height * zoom}px`,
            position: 'relative',
          }}
        >
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => {
              onCropChange(percentCrop);
              onCropComplete(percentCrop);
            }}
            onComplete={(_, percentCrop) => {
              onCropChange(percentCrop);
              onCropComplete(percentCrop);
            }}
            aspect={currentAspect}
          >
            <img
              src={preview.data_url}
              alt={imageFilename}
              style={{ width: '100%', height: '100%', display: 'block' }}
              draggable={false}
            />
          </ReactCrop>

          {showMask && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${my}%`,
                  background: 'rgba(0,0,0,0.5)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${100 - my - mh}%`,
                  background: 'rgba(0,0,0,0.5)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: `${my}%`,
                  left: 0,
                  width: `${mx}%`,
                  height: `${mh}%`,
                  background: 'rgba(0,0,0,0.5)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: `${my}%`,
                  right: 0,
                  width: `${100 - mx - mw}%`,
                  height: `${mh}%`,
                  background: 'rgba(0,0,0,0.5)',
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div>加载预览中...</div>
        </div>
      )}
    </div>
  );
}
