import { useState, useEffect, useCallback } from 'react';
import { ImageOff } from 'lucide-react';
import { SettingsBar } from './components/SettingsBar';
import { ImageGrid, StatusFilter } from './components/ImageGrid';
import { ImageEditor } from './components/ImageEditor';
import { CroppedGallery } from './components/CroppedGallery';
import { RecropCompareModal } from './components/RecropCompareModal';

import {
  ImageEntry,
  CropRecord,
  SkipRecord,
  Settings,
  SaveCropRequest,
  CropPreview,
  scanImages,
  getSettings,
  readCropRecords,
  readSkipRecords,
  skipImage,
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

function getResumeImages(
  images: ImageEntry[],
  records: CropRecord[],
  skipMap: Record<string, SkipRecord> = {},
) {
  const cropped = new Set(records.map((r) => r.relative_path));
  const skipped = new Set(Object.values(skipMap).map((r) => r.relative_path));
  const pending = images.filter((img) => !cropped.has(img.relative_path) && !skipped.has(img.relative_path));

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
      if (!cropped.has(images[i].relative_path) && !skipped.has(images[i].relative_path)) {
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('uncropped');
  const [croppedGalleryOpen, setCroppedGalleryOpen] = useState(false);
  const [cropRecords, setCropRecords] = useState<Record<string, CropRecord[]>>({});
  const [skipRecords, setSkipRecords] = useState<Record<string, SkipRecord>>({});
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

  const loadSkipRecords = useCallback(async () => {
    const records = await readSkipRecords();
    const map = Object.fromEntries(records.map((r) => [r.source_path, r]));
    setSkipRecords(map);
    return map;
  }, []);

  const filterImages = useCallback((all: ImageEntry[], records: Record<string, CropRecord[]>, skipMap: Record<string, SkipRecord>, filter: StatusFilter) => {
    const croppedRel = new Set(Object.values(records).flat().map((r) => r.relative_path));
    const skippedRel = new Set(Object.values(skipMap).map((r) => r.relative_path));
    const isCropped = (img: ImageEntry) => croppedRel.has(img.relative_path);
    const isSkipped = (img: ImageEntry) => skippedRel.has(img.relative_path);
    if (filter === 'all') return all;
    if (filter === 'cropped') return all.filter(isCropped);
    if (filter === 'skipped') return all.filter(isSkipped);
    if (filter === 'uncropped') return all.filter((img) => !isCropped(img) && !isSkipped(img));
    return all;
  }, []);

  const applyVisibility = useCallback((all: ImageEntry[], records: Record<string, CropRecord[]>, skipMap: Record<string, SkipRecord>, filter: StatusFilter) => {
    const list = filterImages(all, records, skipMap, filter);
    setImages(list);
    setSelectedIndex(list.length > 0 ? 0 : -1);
  }, [filterImages]);

  const handleImportComplete = useCallback(async () => {
    const records = await readCropRecords();
    const skipMap = await loadSkipRecords();
    const grouped = groupBySourcePath(records);
    setCropRecords(grouped);
    applyVisibility(allImages, grouped, skipMap, statusFilter);
  }, [allImages, applyVisibility, statusFilter]);

  const performScan = useCallback(async (s: Settings) => {
    setLoading(true);
    try {
      const imgs = await scanImages(includeNsfw);
      let records: CropRecord[] = [];
      if (s.output_dir) {
        records = await readCropRecords();
      }
      const skipMap = await loadSkipRecords();
      const grouped = groupBySourcePath(records);
      setCropRecords(grouped);
      setAllImages(imgs);

      const { pending, selectedIndex: resumeIdx } = getResumeImages(imgs, records, skipMap);

      if (statusFilter === 'all') {
        setImages(imgs);
        if (resumeIdx >= 0 && pending[resumeIdx]) {
          const fullIdx = imgs.findIndex((i) => i.relative_path === pending[resumeIdx].relative_path);
          setSelectedIndex(fullIdx >= 0 ? fullIdx : 0);
        } else {
          setSelectedIndex(imgs.length > 0 ? 0 : -1);
        }
      } else if (statusFilter === 'uncropped') {
        setImages(pending);
        setSelectedIndex(resumeIdx);
      } else {
        const list = filterImages(imgs, grouped, skipMap, statusFilter);
        setImages(list);
        setSelectedIndex(list.length > 0 ? 0 : -1);
      }
    } finally {
      setLoading(false);
    }
  }, [includeNsfw, statusFilter, filterImages]);

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
      setSkipRecords({});
      setTimeout(() => performScan(s), 0);
    }
  }, [settings.source_dir, performScan]);

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const advanceAfterCompletedCrop = useCallback((record: CropRecord) => {
    if (statusFilter === 'all' || statusFilter === 'cropped') {
      setImages((prev) => {
        setSelectedIndex((i) => Math.min(Math.max(0, prev.length - 1), i + 1));
        return prev;
      });
    } else {
      setImages((prev) => {
        const idx = prev.findIndex((img) => img.source_path === record.source_path || img.relative_path === record.relative_path);
        const next = prev.filter((img) => img.source_path !== record.source_path && img.relative_path !== record.relative_path);
        setSelectedIndex(() => {
          if (next.length === 0) return -1;
          if (idx < 0) return Math.min(selectedIndex, next.length - 1);
          return Math.min(idx, next.length - 1);
        });
        return next;
      });
    }
  }, [selectedIndex, statusFilter, images.length]);

  const addCropRecord = useCallback((record: CropRecord) => {
    setCropRecords((prev) => {
      const next = { ...prev };
      next[record.source_path] = [...(next[record.source_path] || []), record];
      return next;
    });
    setSkipRecords((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].relative_path === record.relative_path || key === record.source_path) {
          delete next[key];
        }
      }
      return next;
    });
  }, []);

  const handleSaveCrop = useCallback((record: CropRecord) => {
    addCropRecord(record);
    advanceAfterCompletedCrop(record);
  }, [addCropRecord, advanceAfterCompletedCrop]);

  const handleSaveAndContinueCrop = useCallback((record: CropRecord) => {
    addCropRecord(record);
  }, [addCropRecord]);

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
    setSkipRecords((prev) => {
      const next = { ...prev };
      delete next[sourcePath];
      return next;
    });
  }, []);

  const handleDeleteCropRecord = useCallback((deleted: CropRecord) => {
    setCropRecords((prev) => {
      const flat = Object.values(prev).flat();
      const getFilename = (path: string) => path.split(/[\\/]/).pop() || path;
      const nextFlat = flat.filter(
        (r) =>
          r.output_path !== deleted.output_path &&
          !(
            r.relative_path === deleted.relative_path &&
            getFilename(r.output_path) === getFilename(deleted.output_path)
          )
      );
      const nextGrouped = groupBySourcePath(nextFlat);
      applyVisibility(allImages, nextGrouped, skipRecords, statusFilter);
      return nextGrouped;
    });
  }, [allImages, skipRecords, statusFilter, applyVisibility]);

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
      advanceAfterCompletedCrop(newRecord);
      setRecropTarget(null);
      setRecropCompare(null);
      setPreRecropSelection(null);
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)));
    }
  }, [recropCompare, advanceAfterCompletedCrop]);

  const handleSkipImage = useCallback(async () => {
    if (!selectedImage) return;
    const skippedSourcePath = selectedImage.source_path;
    const skippedRelativePath = selectedImage.relative_path;
    const record = await skipImage(skippedSourcePath);
    setSkipRecords((prev) => ({
      ...prev,
      [record.source_path]: record,
      [skippedSourcePath]: record,
    }));
    setImages((prev) => {
      const idx = prev.findIndex((img) =>
        img.source_path === skippedSourcePath ||
        img.source_path === record.source_path ||
        img.relative_path === skippedRelativePath
      );
      const next = prev.filter((img) =>
        img.source_path !== skippedSourcePath &&
        img.source_path !== record.source_path &&
        img.relative_path !== skippedRelativePath
      );
      setSelectedIndex(() => {
        if (next.length === 0) return -1;
        return Math.min(idx, next.length - 1);
      });
      return next;
    });
  }, [selectedImage]);

  const handleCancelRecrop = useCallback(() => {
    const previous = preRecropSelection;
    const target = recropTarget;

    setRecropTarget(null);
    setRecropCompare(null);
    setPreRecropSelection(null);
    setCroppedGalleryOpen(true);

    setImages((prev) => {
      let next = prev;

      if (statusFilter === 'uncropped' && target) {
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
  }, [preRecropSelection, recropTarget, statusFilter]);

  return (
    <div className="app-shell">
      <SettingsBar
        settings={settings}
        onSettingsChange={handleSettingsChange}
        includeNsfw={includeNsfw}
        onIncludeNsfwChange={setIncludeNsfw}
        showCropped={showCropped}
        onShowCroppedChange={(v) => {
          const newFilter = v ? 'all' : 'uncropped';
          setShowCropped(v);
          setStatusFilter(newFilter);
          applyVisibility(allImages, cropRecords, skipRecords, newFilter);
        }}
        onScan={handleScan}
        loading={loading}
        onImportComplete={handleImportComplete}
        onCroppedGalleryOpen={() => setCroppedGalleryOpen(true)}
      />
      <div className="app-body">
        <div className="sidebar">
          <ImageGrid
            images={images}
            selectedIndex={selectedIndex}
            cropRecords={cropRecords}
            skipRecords={skipRecords}
            onSelect={handleSelect}
            statusFilter={statusFilter}
            onStatusFilterChange={(filter) => {
              setStatusFilter(filter);
              const newShowCropped = filter !== 'uncropped';
              if (showCropped !== newShowCropped) {
                setShowCropped(newShowCropped);
              }
              applyVisibility(allImages, cropRecords, skipRecords, filter);
            }}
          />
        </div>
        <div className="editor">
          {selectedImage ? (
            <ImageEditor
              image={selectedImage}
              existingCrops={cropRecords[selectedImage.source_path] || []}
              onSave={handleSaveCrop}
              onSaveAndContinue={handleSaveAndContinueCrop}
              onDelete={handleDeleteImage}
              onSkipImage={handleSkipImage}
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
          onDeleteCropRecord={handleDeleteCropRecord}
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
