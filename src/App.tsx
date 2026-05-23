import { useState, useEffect, useCallback } from 'react';
import { ImageOff } from 'lucide-react';
import { SettingsBar } from './components/SettingsBar';
import { ImageGrid } from './components/ImageGrid';
import { ImageEditor } from './components/ImageEditor';
import { CroppedGallery } from './components/CroppedGallery';
import { RecropCompareModal } from './components/RecropCompareModal';

import {
  ImageEntry,
  CropRecord,
  Settings,
  SaveCropRequest,
  CropPreview,
  scanImages,
  getSettings,
  readCropRecords,
  resolveOriginalForRecord,
  previewCrop,
  saveRecrop,
  pickSourceDir,
  setSourceDir,
} from './api';

function groupBySourcePath(records: CropRecord[]): Record<string, CropRecord[]> {
  const map: Record<string, CropRecord[]> = {};
  for (const r of records) {
    if (!map[r.source_path]) map[r.source_path] = [];
    map[r.source_path].push(r);
  }
  return map;
}

function getResumeImages(images: ImageEntry[], records: CropRecord[]) {
  const cropped = new Set(records.map((r) => r.relative_path));
  const pending = images.filter((img) => !cropped.has(img.relative_path));

  if (pending.length === 0) {
    return { pending, selectedIndex: -1 };
  }

  const last = records[records.length - 1];
  if (!last) {
    return { pending, selectedIndex: 0 };
  }

  const lastFullIndex = images.findIndex((img) => img.relative_path === last.relative_path);

  if (lastFullIndex >= 0) {
    for (let i = lastFullIndex + 1; i < images.length; i++) {
      if (!cropped.has(images[i].relative_path)) {
        const pendingIndex = pending.findIndex((img) => img.relative_path === images[i].relative_path);
        return { pending, selectedIndex: pendingIndex >= 0 ? pendingIndex : 0 };
      }
    }
  }

  return { pending, selectedIndex: 0 };
}

export default function App() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [allImages, setAllImages] = useState<ImageEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [settings, setSettings] = useState<Settings>({ source_dir: '', output_dir: '' });
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [showCropped, setShowCropped] = useState(false);
  const [croppedGalleryOpen, setCroppedGalleryOpen] = useState(false);
  const [cropRecords, setCropRecords] = useState<Record<string, CropRecord[]>>({});
  const [loading, setLoading] = useState(false);
  const [recropTarget, setRecropTarget] = useState<CropRecord | null>(null);
  const [recropCompare, setRecropCompare] = useState<{
    oldRecord: CropRecord;
    preview: CropPreview;
    cropRequest: SaveCropRequest;
  } | null>(null);
  const [preRecropSelection, setPreRecropSelection] = useState<{
    image: ImageEntry | null;
    index: number;
  } | null>(null);
  const RATIO_MODES = ['free', '16:9', '16:10', '4:3', '1:1', '3:2', '2:3', '21:9'];
  const [lastRatioMode, setLastRatioMode] = useState(() => {
    const stored = localStorage.getItem('lastRatioMode');
    return stored && RATIO_MODES.includes(stored) ? stored : 'free';
  });

  const handleRatioModeChange = useCallback((value: string) => {
    setLastRatioMode(value);
    localStorage.setItem('lastRatioMode', value);
  }, []);

  useEffect(() => {
    getSettings().then((s) => setSettings(s));
  }, []);

  useEffect(() => {
    if (!settings.source_dir) return;
    performScan(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeNsfw]);

  const loadCropRecords = useCallback(async () => {
    const records = await readCropRecords();
    setCropRecords(groupBySourcePath(records));
  }, []);

  const applyVisibility = useCallback((show: boolean, all: ImageEntry[], records: Record<string, CropRecord[]>) => {
    if (show) {
      setImages(all);
      setSelectedIndex(all.length > 0 ? 0 : -1);
    } else {
      const cropped = new Set(Object.values(records).flat().map((r) => r.relative_path));
      const pending = all.filter((img) => !cropped.has(img.relative_path));
      setImages(pending);
      setSelectedIndex(pending.length > 0 ? 0 : -1);
    }
  }, []);

  const performScan = useCallback(async (s: Settings) => {
    setLoading(true);
    try {
      const imgs = await scanImages(includeNsfw);
      let records: CropRecord[] = [];
      if (s.output_dir) {
        records = await readCropRecords();
      }
      setCropRecords(groupBySourcePath(records));
      setAllImages(imgs);

      const { pending, selectedIndex: resumeIdx } = getResumeImages(imgs, records);

      if (showCropped) {
        setImages(imgs);
        if (resumeIdx >= 0 && pending[resumeIdx]) {
          const fullIdx = imgs.findIndex((i) => i.relative_path === pending[resumeIdx].relative_path);
          setSelectedIndex(fullIdx >= 0 ? fullIdx : 0);
        } else {
          setSelectedIndex(imgs.length > 0 ? 0 : -1);
        }
      } else {
        setImages(pending);
        setSelectedIndex(resumeIdx);
      }
    } finally {
      setLoading(false);
    }
  }, [includeNsfw, showCropped]);

  const handleScan = useCallback(() => {
    performScan(settings);
  }, [performScan, settings]);

  const handleSettingsChange = useCallback((s: Settings) => {
    setSettings(s);
    const sourceChanged = s.source_dir !== settings.source_dir;
    if (sourceChanged) {
      setImages([]);
      setAllImages([]);
      setSelectedIndex(-1);
      setCropRecords({});
      setTimeout(() => performScan(s), 0);
    }
  }, [settings.source_dir, performScan]);

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleSaveCrop = useCallback((record: CropRecord) => {
    setCropRecords((prev) => {
      const next = { ...prev };
      next[record.source_path] = [...(next[record.source_path] || []), record];
      return next;
    });

    if (showCropped) {
      setSelectedIndex((i) => Math.min(images.length - 1, i + 1));
    } else {
      setImages((prev) => {
        const idx = prev.findIndex((img) => img.source_path === record.source_path);
        const next = prev.filter((img) => img.source_path !== record.source_path);
        setSelectedIndex(() => {
          if (next.length === 0) return -1;
          if (idx < 0) return Math.min(selectedIndex, next.length - 1);
          return Math.min(idx, next.length - 1);
        });
        return next;
      });
    }
  }, [selectedIndex, showCropped, images.length]);

  const handleDeleteImage = useCallback((sourcePath: string) => {
    setAllImages((prev) => prev.filter((i) => i.source_path !== sourcePath));
    setImages((prev) => {
      const idx = prev.findIndex((i) => i.source_path === sourcePath);
      const next = prev.filter((i) => i.source_path !== sourcePath);
      if (next.length === 0) {
        setSelectedIndex(-1);
      } else if (idx >= next.length) {
        setSelectedIndex(next.length - 1);
      } else {
        setSelectedIndex(idx);
      }
      return next;
    });
    setCropRecords((prev) => {
      const next = { ...prev };
      delete next[sourcePath];
      return next;
    });
  }, []);

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;

  const startRecrop = useCallback(async (record: CropRecord) => {
    try {
      setPreRecropSelection({ image: selectedImage, index: selectedIndex });
      const entry = await resolveOriginalForRecord(record);
      setAllImages((prev) => {
        const exists = prev.some((i) => i.relative_path === entry.relative_path);
        return exists ? prev : [...prev, entry];
      });
      setImages((prev) => {
        const exists = prev.some((i) => i.relative_path === entry.relative_path);
        const next = exists ? prev : [...prev, entry];
        const idx = next.findIndex((i) => i.relative_path === entry.relative_path);
        setSelectedIndex(idx >= 0 ? idx : 0);
        return next;
      });
      setRecropTarget(record);
      setCroppedGalleryOpen(false);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }, [selectedImage, selectedIndex]);

  const handlePreviewRecrop = useCallback(async (request: SaveCropRequest) => {
    if (!recropTarget) return;
    try {
      const p = await previewCrop(request);
      setRecropCompare({
        oldRecord: recropTarget,
        preview: p,
        cropRequest: request,
      });
    } catch (e: any) {
      alert('预览生成失败: ' + (e?.message || String(e)));
    }
  }, [recropTarget]);

  const handleConfirmRecrop = useCallback(async () => {
    if (!recropCompare) return;
    try {
      const newRecord = await saveRecrop({
        old_output_path: recropCompare.oldRecord.output_path,
        crop: recropCompare.cropRequest,
      });
      setCropRecords((prev) => {
        const flat = Object.values(prev).flat();
        const nextFlat = flat.map((r) =>
          r.output_path === recropCompare!.oldRecord.output_path ? newRecord : r
        );
        return groupBySourcePath(nextFlat);
      });
      setRecropTarget(null);
      setRecropCompare(null);
      setPreRecropSelection(null);
      alert('已更新裁剪记录');
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)));
    }
  }, [recropCompare]);

  const handleCancelRecrop = useCallback(() => {
    const previous = preRecropSelection;
    const target = recropTarget;

    setRecropTarget(null);
    setRecropCompare(null);
    setPreRecropSelection(null);
    setCroppedGalleryOpen(true);

    setImages((prev) => {
      let next = prev;

      if (!showCropped && target) {
        next = prev.filter((img) => img.relative_path !== target.relative_path);
      }

      if (!previous?.image) {
        setSelectedIndex(-1);
      } else {
        const foundIdx = next.findIndex((img) => img.relative_path === previous.image!.relative_path);
        if (foundIdx >= 0) {
          setSelectedIndex(foundIdx);
        } else if (next.length > 0) {
          setSelectedIndex(Math.min(previous.index, next.length - 1));
        } else {
          setSelectedIndex(-1);
        }
      }

      return next;
    });
  }, [preRecropSelection, recropTarget, showCropped]);

  return (
    <div className="app-shell">
      <SettingsBar
        settings={settings}
        onSettingsChange={handleSettingsChange}
        includeNsfw={includeNsfw}
        onIncludeNsfwChange={setIncludeNsfw}
        showCropped={showCropped}
        onShowCroppedChange={(v) => {
          setShowCropped(v);
          applyVisibility(v, allImages, cropRecords);
        }}
        onScan={handleScan}
        loading={loading}
        onImportComplete={loadCropRecords}
        onCroppedGalleryOpen={() => setCroppedGalleryOpen(true)}
      />
      <div className="app-body">
        <div className="sidebar">
          <ImageGrid
            images={images}
            selectedIndex={selectedIndex}
            cropRecords={cropRecords}
            onSelect={handleSelect}
          />
        </div>
        <div className="editor">
          {selectedImage ? (
            <ImageEditor
              image={selectedImage}
              existingCrops={cropRecords[selectedImage.source_path] || []}
              onSave={handleSaveCrop}
              onDelete={handleDeleteImage}
              onPrev={() => setSelectedIndex((i) => Math.max(0, i - 1))}
              onNext={() => setSelectedIndex((i) => Math.min(images.length - 1, i + 1))}
              settings={settings}
              ratioMode={lastRatioMode}
              onRatioModeChange={handleRatioModeChange}
              recropTarget={recropTarget}
              onPreviewRecrop={handlePreviewRecrop}
              onCancelRecrop={handleCancelRecrop}
            />
          ) : settings.source_dir ? (
            <div className="empty-state">
              <ImageOff size={40} style={{ opacity: 0.3 }} />
              <div className="empty-state-title">选择一张图片开始裁剪</div>
              <div className="empty-state-sub">扫描图库后，从左侧选择图片</div>
            </div>
          ) : (
            <div className="empty-state">
              <ImageOff size={48} style={{ opacity: 0.3 }} />
              <div className="empty-state-title" style={{ marginBottom: 16 }}>请选择图库目录</div>
              <button
                className="btn btn-accent"
                onClick={async () => {
                  const path = await pickSourceDir();
                  if (path) {
                    const s = await setSourceDir(path);
                    handleSettingsChange(s);
                  }
                }}
              >
                选择图库
              </button>
            </div>
          )}
        </div>
      </div>
      {croppedGalleryOpen && (
        <CroppedGallery
          records={Object.values(cropRecords).flat()}
          onClose={() => setCroppedGalleryOpen(false)}
          onRecrop={startRecrop}
        />
      )}
      {recropCompare && (
        <RecropCompareModal
          oldRecord={recropCompare.oldRecord}
          preview={recropCompare.preview}
          onConfirm={handleConfirmRecrop}
          onAdjust={() => setRecropCompare(null)}
          onCancel={handleCancelRecrop}
        />
      )}
    </div>
  );
}
