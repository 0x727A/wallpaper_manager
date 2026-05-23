import { useState } from 'react';
import { X, FileJson, Play } from 'lucide-react';
import { pickJsonFile, runBatchFromJson, BatchResult } from '../api';

interface Props {
  settings: { output_dir: string };
  onClose: () => void;
  onRecordsUpdate: () => void;
}

export function BatchPanel({ settings, onClose, onRecordsUpdate }: Props) {
  const [jsonPath, setJsonPath] = useState('');
  const [outputDir, setOutputDir] = useState(settings.output_dir);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  const handlePickJson = async () => {
    const path = await pickJsonFile();
    if (path) setJsonPath(path);
  };

  const handleRun = async () => {
    if (!jsonPath || !outputDir) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await runBatchFromJson(jsonPath, outputDir);
      setResult(res);
      onRecordsUpdate();
    } catch (e: any) {
      alert('批量裁剪失败: ' + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#1a1a1a', borderRadius: 8, width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #333' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>批量裁剪</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>crops.json</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
                placeholder="选择 crops.json 文件"
                style={{ flex: 1, padding: '6px 8px', fontSize: 13, background: '#222', border: '1px solid #444', color: '#eee', borderRadius: 4 }}
              />
              <button onClick={handlePickJson} style={{ padding: '6px 10px', background: '#333', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}><FileJson size={16} /></button>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>输出目录</label>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: '#222', border: '1px solid #444', color: '#eee', borderRadius: 4 }}
            />
          </div>

          <button
            onClick={handleRun}
            disabled={running || !jsonPath || !outputDir}
            style={{ width: '100%', padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#2a5', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}
          >
            <Play size={16} />
            {running ? '执行中...' : '开始批量裁剪'}
          </button>

          {result && (
            <div style={{ marginTop: 16, padding: 12, background: '#222', borderRadius: 4 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                成功: <span style={{ color: '#4a9eff' }}>{result.success}</span> &nbsp;
                失败: <span style={{ color: '#ff4a4a' }}>{result.failed}</span>
              </div>
              {result.failures.length > 0 && (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {result.failures.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#ff8888', padding: '2px 0' }}>
                      {f.source_path}: {f.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
