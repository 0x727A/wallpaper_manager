import { useState } from 'react';
import { FolderOpen, ScanLine, Eye, EyeOff, FileJson, CheckSquare, Square, Images, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import {
  Settings as SettingsType,
  pickOutputDir,
  setOutputDir,
  pickSourceDir,
  setSourceDir,
  pickJsonFile,
  runBatchFromJson,
  cancelBatch,
  BatchResult,
  BatchProgress,
} from '../api';

function dirName(path: string): string {
  if (!path) return '未设置';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

interface Props {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
  includeNsfw: boolean;
  onIncludeNsfwChange: (v: boolean) => void;
  showCropped: boolean;
  onShowCroppedChange: (v: boolean) => void;
  onCroppedGalleryOpen: () => void;
  onScan: () => void;
  loading: boolean;
  onImportComplete: () => void;
}

export function SettingsBar({
  settings,
  onSettingsChange,
  includeNsfw,
  onIncludeNsfwChange,
  showCropped,
  onShowCroppedChange,
  onCroppedGalleryOpen,
  onScan,
  loading,
  onImportComplete,
}: Props) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);

  const handlePickOutputDir = async () => {
    const path = await pickOutputDir();
    if (path) {
      const s = await setOutputDir(path);
      onSettingsChange(s);
    }
  };

  const handlePickSourceDir = async () => {
    const path = await pickSourceDir();
    if (path) {
      const s = await setSourceDir(path);
      onSettingsChange(s);
    }
  };

  const handleCancelBatch = async () => {
    if (batchJobId) {
      await cancelBatch(batchJobId);
    }
  };

  const handleBatchCrop = async () => {
    const jsonPath = await pickJsonFile();
    if (!jsonPath) return;
    const jobId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setBatchRunning(true);
    setBatchResult(null);
    setBatchProgress(null);
    setBatchJobId(jobId);
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<BatchProgress>(`batch-progress-${jobId}`, (event) => {
        setBatchProgress(event.payload);
      });
      const result = await runBatchFromJson(jsonPath, settings.output_dir, jobId);
      setBatchResult(result);
      if (result.cancelled) {
        alert(`已取消。已处理 ${result.done}/${result.total}，成功 ${result.success}，失败 ${result.failed}`);
      } else {
        const msg = `批量裁剪完成：成功 ${result.success} 条，失败 ${result.failed} 条`;
        if (result.failed > 0 && result.failures.length > 0) {
          const details = result.failures
            .slice(0, 5)
            .map((f) => `  ${f.source_path}: ${f.reason}`)
            .join('\n');
          alert(msg + '\n\n失败详情（前5条）:\n' + details);
        } else {
          alert(msg + '\n已自动清理对应跳过记录并刷新列表。');
        }
      }
      onImportComplete();
    } catch (e: any) {
      alert('批量裁剪失败: ' + (e?.message || String(e)));
    } finally {
      if (unlisten) unlisten();
      setBatchRunning(false);
      setBatchJobId(null);
      setBatchProgress(null);
    }
  };

  return (
    <div className="topbar">
      <div className="topbar-section title">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          Wallhaven 裁剪记录器
        </span>
      </div>

      <div className="topbar-section paths">
        <div className="path-pill" title={settings.source_dir}>
          <span className="label">图库</span>
          <span className="value">{dirName(settings.source_dir)}</span>
          <button className="btn btn-icon btn-sm" onClick={handlePickSourceDir} title="选择原图库目录" style={{ marginLeft: 4 }}>
            <FolderOpen size={12} />
          </button>
        </div>

        <div className="path-pill" title={settings.output_dir}>
          <span className="label">输出</span>
          <span className="value">{dirName(settings.output_dir)}</span>
          <button className="btn btn-icon btn-sm" onClick={handlePickOutputDir} title="选择裁剪输出目录" style={{ marginLeft: 4 }}>
            <FolderOpen size={12} />
          </button>
        </div>
      </div>

      <div className="topbar-section actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onIncludeNsfwChange(!includeNsfw)}
          title={includeNsfw ? '隐藏 NSFW' : '显示 NSFW'}
          style={{
            background: includeNsfw ? 'var(--danger-soft)' : undefined,
            borderColor: includeNsfw ? 'var(--danger)' : undefined,
            color: includeNsfw ? 'var(--danger)' : undefined,
          }}
        >
          {includeNsfw ? <Eye size={13} /> : <EyeOff size={13} />}
          NSFW
        </button>

        <button
          className="btn btn-sm"
          onClick={handleBatchCrop}
          disabled={loading || batchRunning}
          title="选择裁剪记录 JSON 并执行批量裁剪"
        >
          <FileJson size={13} />
          {batchRunning && batchProgress
            ? `裁剪中 ${batchProgress.done}/${batchProgress.total}`
            : '批量裁剪'}
        </button>

        {batchRunning && batchJobId && (
          <button
            className="btn btn-sm btn-danger"
            onClick={handleCancelBatch}
            title="取消批量裁剪"
            style={{ padding: '4px 8px' }}
          >
            <X size={12} />
          </button>
        )}

        {batchResult && !batchRunning && (
          <span
            style={{
              fontSize: 11,
              color: batchResult.failed > 0 ? 'var(--danger)' : 'var(--success)',
              whiteSpace: 'nowrap',
            }}
          >
            成功 {batchResult.success} / 失败 {batchResult.failed}
          </span>
        )}

        <button className="btn btn-sm" onClick={onCroppedGalleryOpen} title="已裁剪图片">
          <Images size={13} />
          已裁剪
        </button>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onShowCroppedChange(!showCropped)}
          title={showCropped ? '隐藏已裁剪' : '显示已裁剪'}
          style={{
            background: showCropped ? 'var(--accent-soft)' : undefined,
            borderColor: showCropped ? 'var(--accent)' : undefined,
            color: showCropped ? 'var(--accent)' : undefined,
          }}
        >
          {showCropped ? <CheckSquare size={13} /> : <Square size={13} />}
          {showCropped ? '隐藏已裁剪' : '显示已裁剪'}
        </button>

        <button className="btn btn-accent" onClick={onScan} disabled={loading || batchRunning || !settings.source_dir}>
          <ScanLine size={14} />
          {loading ? '扫描中...' : '扫描'}
        </button>
      </div>
    </div>
  );
}
