import ReactCrop, { PercentCrop } from 'react-image-crop';
import { GuideMode } from './types';

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
}: CropCanvasProps) {
  return (
    <div ref={editorViewportRef} onWheel={onWheelZoom} className="canvas-area">
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
        </div>
      ) : (
        <div className="empty-state">
          <div>加载预览中...</div>
        </div>
      )}
    </div>
  );
}
