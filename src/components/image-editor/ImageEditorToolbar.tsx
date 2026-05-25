import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM, BUTTON_ZOOM_STEP } from './constants';

interface ImageEditorToolbarProps {
  onPrev: () => void;
  onNext: () => void;
  saving: boolean;
  sourceDir: string;
  relativePath: string;
  filename: string;
  dimensions: string;
  zoom: number;
  fitZoom: number;
  onZoomChange: (zoom: number) => void;
}

export function ImageEditorToolbar({
  onPrev,
  onNext,
  saving,
  sourceDir,
  relativePath,
  filename,
  dimensions,
  zoom,
  fitZoom,
  onZoomChange,
}: ImageEditorToolbarProps) {
  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const sourceFolder = sourceDir.split(/[\\/]/).filter(Boolean).pop() || '';
  const parts = relativePath.split('/');
  const dir = parts.slice(0, -1).join('/');
  const fullDir = sourceFolder ? (dir ? `${sourceFolder}/${dir}` : sourceFolder) : dir;

  return (
    <div className="editor-toolbar">
      <button className="btn btn-icon" onClick={onPrev} disabled={saving} title="上一张">
        <ChevronLeft size={16} />
      </button>
      <button className="btn btn-icon" onClick={onNext} disabled={saving} title="下一张">
        <ChevronRight size={16} />
      </button>
      <div className="filename" title={`${sourceDir}/${relativePath}`}>
        {fullDir && <span className="file-dir">{fullDir}/</span>}
        <span className="file-name">{filename}</span>
      </div>
      <div className="meta">{dimensions}</div>
      <button
        className="btn btn-icon btn-sm"
        onClick={() => onZoomChange(clampZoom(zoom - BUTTON_ZOOM_STEP))}
        title="缩小"
        disabled={saving}
      >
        <ZoomOut size={14} />
      </button>
      <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 40, textAlign: 'center' }}>
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="btn btn-icon btn-sm"
        onClick={() => onZoomChange(clampZoom(zoom + BUTTON_ZOOM_STEP))}
        title="放大"
        disabled={saving}
      >
        <ZoomIn size={14} />
      </button>
      <button
        className="btn btn-icon btn-sm"
        onClick={() => onZoomChange(fitZoom)}
        title="适应窗口"
        disabled={saving}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
