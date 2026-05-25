import { Save, Trash2, Eye } from 'lucide-react';
import { PercentCrop } from 'react-image-crop';
import { CropRecord } from '../../api';
import { RATIOS } from './constants';
import { GuideMode, OutputMode, Rating } from './types';

interface ImageEditorInspectorProps {
  settings: { source_dir: string; output_dir: string };
  cropName: string;
  onCropNameChange: (name: string) => void;
  ratioMode: string;
  onRatioChange: (value: string) => void;
  outputMode: OutputMode;
  onOutputModeChange: (mode: OutputMode) => void;
  rating: Rating;
  onRatingChange: (rating: Rating) => void;
  guideMode: GuideMode;
  onGuideModeChange: (mode: GuideMode) => void;
  completedCrop: PercentCrop | undefined;
  preview: { original_width: number; original_height: number } | null;
  onWidthChange: (val: number) => void;
  onHeightChange: (val: number) => void;
  isRecropActive: boolean;
  saving: boolean;
  onPreviewRecrop?: () => void;
  onCancelRecrop?: () => void;
  onSave: () => void;
  onSaveAndContinue?: () => void;
  onSkipImage?: () => void;
  onDelete: () => void;
  existingCrops: CropRecord[];
}

export function ImageEditorInspector({
  settings,
  cropName,
  onCropNameChange,
  ratioMode,
  onRatioChange,
  outputMode,
  onOutputModeChange,
  rating,
  onRatingChange,
  guideMode,
  onGuideModeChange,
  completedCrop,
  preview,
  onWidthChange,
  onHeightChange,
  isRecropActive,
  saving,
  onPreviewRecrop,
  onCancelRecrop,
  onSave,
  onSaveAndContinue,
  onSkipImage,
  onDelete,
  existingCrops,
}: ImageEditorInspectorProps) {
  const hasCrop = !!completedCrop && !!preview;

  return (
    <div className="inspector">
      <div className="panel-group">
        <div className="panel-group-title">输出目录</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={settings.output_dir}
        >
          {settings.output_dir || '未设置'}
        </div>
      </div>

      <div className="panel-group">
        <div className="panel-group-title">裁剪名称</div>
        <input
          className="input"
          type="text"
          value={cropName}
          onChange={(e) => onCropNameChange(e.target.value)}
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
              onClick={() => onRatioChange(r.value)}
              disabled={saving}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-group">
        <div className="panel-group-title">输出模式</div>
        <div className="output-mode-grid">
          <button
            type="button"
            className={`ratio-btn${outputMode === 'crop' ? ' active' : ''}`}
            onClick={() => onOutputModeChange('crop')}
            disabled={saving}
          >
            硬裁剪
          </button>
          <button
            type="button"
            className={`ratio-btn${outputMode === 'mask' ? ' active' : ''}`}
            onClick={() => onOutputModeChange('mask')}
            disabled={saving}
          >
            遮罩保留
          </button>
        </div>
      </div>

      <div className="panel-group">
        <div className="panel-group-title">星级</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-icon btn-sm"
              onClick={() => onRatingChange(rating === s ? 0 : (s as 1 | 2 | 3))}
              style={{ color: s <= rating ? 'var(--accent)' : 'var(--muted)' }}
              title={`${s}星`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="panel-group">
        <div className="panel-group-title">辅助线</div>
        <select
          className="select"
          value={guideMode}
          onChange={(e) => onGuideModeChange(e.target.value as GuideMode)}
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
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'monospace',
            lineHeight: 1.6,
          }}
        >
          {hasCrop ? (
            <>
              x: {Math.round((completedCrop.x * preview.original_width) / 100)}
              <br />
              y: {Math.round((completedCrop.y * preview.original_height) / 100)}
              <br />
              w:{" "}
              <input
                type="number"
                min={1}
                max={preview.original_width}
                value={Math.round((completedCrop.width * preview.original_width) / 100)}
                onChange={(e) => onWidthChange(Number(e.target.value))}
                style={{ width: 60, fontSize: 12, fontFamily: 'monospace' }}
              />
              <br />
              h:{" "}
              <input
                type="number"
                min={1}
                max={preview.original_height}
                value={Math.round((completedCrop.height * preview.original_height) / 100)}
                onChange={(e) => onHeightChange(Number(e.target.value))}
                style={{ width: 60, fontSize: 12, fontFamily: 'monospace' }}
              />
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
              onClick={onPreviewRecrop}
              disabled={saving || !hasCrop}
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
          <>
            <button
              className="btn btn-success"
              onClick={onSave}
              disabled={saving || !hasCrop}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <Save size={14} />
              {saving ? '保存中...' : '保存裁剪'}
            </button>
            {onSaveAndContinue && (
              <button
                className="btn btn-accent"
                onClick={onSaveAndContinue}
                disabled={saving || !hasCrop}
                style={{ width: '100%', marginBottom: 8 }}
              >
                <Save size={14} />
                保存并继续裁剪
              </button>
            )}
          </>
        )}

        {!isRecropActive && onSkipImage && (
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
          onClick={onDelete}
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
          <div
            key={i}
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              padding: '6px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text)' }}>{c.crop_name}</span>
              {(c.rating || 0) > 0 && (
                <span style={{ color: 'var(--accent)' }}>{'★'.repeat(c.rating || 0)}</span>
              )}
            </div>
            <div>
              {c.width}×{c.height} ({c.ratio_mode})
            </div>
            <div style={{ color: 'var(--muted-2)', fontSize: 10 }}>{c.output_filename}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
