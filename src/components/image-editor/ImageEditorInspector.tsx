import { Save, Trash2, Eye, Check, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
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
  onConfirmRecrop?: () => void;
  onSave: () => void;
  onSaveAndContinue?: () => void;
  onSkipImage?: () => void;
  onDelete: () => void;
  existingCrops: CropRecord[];
  isContinueCropActive?: boolean;
  onSaveAndPreview?: () => void;
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
  onConfirmRecrop,
  onSave,
  onSaveAndContinue,
  onSkipImage,
  onDelete,
  existingCrops,
  isContinueCropActive,
  onSaveAndPreview,
}: ImageEditorInspectorProps) {
  const hasCrop = !!completedCrop && !!preview;
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  useEffect(() => {
    if (saving) setConfirmDelete(false);
  }, [saving]);

  return (
    <div className="inspector">
      {/* 基础信息 */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>基础信息</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 3 }}>输出目录</div>
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
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 3 }}>裁剪名称</div>
          <input
            className="input"
            type="text"
            value={cropName}
            onChange={(e) => onCropNameChange(e.target.value)}
            placeholder="例如: 16_9_banner"
          />
        </div>
      </div>

      {/* 裁剪设置 */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>裁剪设置</div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4 }}>比例</div>
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

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4 }}>输出模式</div>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4 }}>星级</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {[1, 2, 3].map((s) => {
                const active = rating === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onRatingChange(rating === s ? 0 : (s as 1 | 2 | 3))}
                    title={`${s}星`}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      background: active ? 'var(--accent-soft)' : 'var(--field)',
                      border: active ? '1px solid var(--accent)' : '1px solid var(--field-border)',
                      color: active ? 'var(--accent)' : 'var(--muted)',
                      fontSize: 14,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                    }}
                  >
                    {s === 3 ? (
                      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, lineHeight: 1, fontSize: 9 }}>
                        <span>★</span>
                        <span style={{ display: 'flex', gap: 1 }}>
                          <span>★</span>
                          <span>★</span>
                        </span>
                      </span>
                    ) : '★'.repeat(s)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4 }}>辅助线</div>
            <select
              className="select"
              value={guideMode}
              onChange={(e) => onGuideModeChange(e.target.value as GuideMode)}
              style={{ width: '100%' }}
            >
              <option value="none">无</option>
              <option value="thirds">三分线</option>
              <option value="diagonal">对角线</option>
              <option value="cross">十字线</option>
              <option value="thirds_diagonal">三分 + 对角</option>
              <option value="thirds_cross">三分 + 十字</option>
            </select>
          </div>
        </div>
      </div>

      {/* 精准坐标 */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>精准坐标</div>
        {hasCrop ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px 12px',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2 }}>x</div>
              <div style={{ color: 'var(--muted)' }}>
                {Math.round((completedCrop.x * preview.original_width) / 100)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2 }}>y</div>
              <div style={{ color: 'var(--muted)' }}>
                {Math.round((completedCrop.y * preview.original_height) / 100)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2 }}>w</div>
              <input
                type="number"
                min={1}
                max={preview.original_width}
                value={Math.round((completedCrop.width * preview.original_width) / 100)}
                onChange={(e) => onWidthChange(Number(e.target.value))}
                style={{
                  width: '100%',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  color: 'var(--text)',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2 }}>h</div>
              <input
                type="number"
                min={1}
                max={preview.original_height}
                value={Math.round((completedCrop.height * preview.original_height) / 100)}
                onChange={(e) => onHeightChange(Number(e.target.value))}
                style={{
                  width: '100%',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  color: 'var(--text)',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>未选择</div>
        )}
      </div>

      {/* 已有裁剪 */}
      <div className="panel-group" style={{ marginBottom: 18 }}>
        <div className="panel-group-title">已有裁剪 ({existingCrops.length})</div>
        {existingCrops.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>暂无已裁剪记录</div>
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

      {/* 操作区 — sticky footer */}
      <div
        style={{
          position: 'sticky',
          bottom: -16,
          margin: '20px -16px -16px',
          padding: '14px 16px 16px',
          background: 'linear-gradient(to bottom, rgba(18,21,26,0), var(--panel) 14px, var(--panel) 100%)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {isRecropActive ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                className="btn"
                onClick={onConfirmRecrop}
                disabled={saving || !hasCrop}
                style={{ height: 42, borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2563eb'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#3b82f6'; }}
              >
                <Check size={14} />
                确定重裁
              </button>
              <button
                className="btn"
                onClick={onPreviewRecrop}
                disabled={saving || !hasCrop}
                style={{ height: 42, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}
              >
                <Eye size={14} />
                预览重裁
              </button>
            </div>
            <button
              className="btn"
              onClick={onCancelRecrop}
              disabled={saving}
              style={{ width: '100%', height: 40, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}
            >
              取消重裁
            </button>
            <button
              className="btn"
              onClick={() => {
                if (confirmDelete) {
                  onDelete();
                } else {
                  setConfirmDelete(true);
                }
              }}
              disabled={saving}
              style={{
                width: '100%',
                height: 40,
                borderRadius: 10,
                color: confirmDelete ? '#fff' : '#ff6b6b',
                background: confirmDelete ? '#ef4444' : 'rgba(239, 68, 68, 0.08)',
                border: confirmDelete ? 'none' : '1px solid rgba(239, 68, 68, 0.45)',
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (confirmDelete) {
                  e.currentTarget.style.background = '#dc2626';
                } else {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.14)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.60)';
                }
              }}
              onMouseLeave={(e) => {
                if (confirmDelete) {
                  e.currentTarget.style.background = '#ef4444';
                } else {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.45)';
                }
              }}
            >
              {confirmDelete ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
              {confirmDelete ? '再次点击确认删除' : '删除原图'}
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                className="btn"
                onClick={onSave}
                disabled={saving || !hasCrop}
                style={{ height: 42, borderRadius: 10, background: '#22c55e', color: '#fff', border: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#16a34a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#22c55e'; }}
              >
                <Save size={14} />
                {saving ? '保存中...' : '保存裁剪'}
              </button>
              {onSaveAndContinue && (
                <button
                  className="btn"
                  onClick={onSaveAndContinue}
                  disabled={saving || !hasCrop}
                  style={{ height: 42, borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#2563eb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#3b82f6'; }}
                >
                  <Save size={14} />
                  保存并继续
                </button>
              )}
            </div>

            {onSaveAndPreview && (
              <button
                className="btn"
                onClick={onSaveAndPreview}
                disabled={saving || !hasCrop}
                style={{
                  width: '100%',
                  height: 40,
                  borderRadius: 10,
                  color: '#3b82f6',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.14)';
                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.50)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.35)';
                }}
              >
                <Eye size={14} />
                保存并预览
              </button>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: onSkipImage ? '1fr 1fr' : '1fr', gap: 10 }}>
              {onSkipImage && (
                <button
                  className="btn"
                  onClick={onSkipImage}
                  disabled={saving}
                  style={{ height: 42, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}
                >
                  {isContinueCropActive ? '结束此图' : '跳过'}
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  if (confirmDelete) {
                    onDelete();
                  } else {
                    setConfirmDelete(true);
                  }
                }}
                disabled={saving}
                style={{
                  height: 42,
                  borderRadius: 10,
                  color: confirmDelete ? '#fff' : '#ff6b6b',
                  background: confirmDelete ? '#ef4444' : 'rgba(239, 68, 68, 0.08)',
                  border: confirmDelete ? 'none' : '1px solid rgba(239, 68, 68, 0.45)',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (confirmDelete) {
                    e.currentTarget.style.background = '#dc2626';
                  } else {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.14)';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.60)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (confirmDelete) {
                    e.currentTarget.style.background = '#ef4444';
                  } else {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.45)';
                  }
                }}
              >
                {confirmDelete ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
                {confirmDelete ? '再次点击确认' : '删除原图'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
