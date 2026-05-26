import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { preloadPreview } from './utils/previewCache';

function groupBySourcePath(records: CropRecord[]): Record<string, CropRecord[]> {
  const map: Record<string, CropRecord[]> = {};
  for (const r of records) {
    if (!map[r.source_path]) map[r.source_path] = [];
    map[r.source_path].push(r);
  }
  return map;
}

function getResumeImages(
  allImages: ImageEntry[],
  records: CropRecord[],
  skipMap: Record<string, SkipRecord> = {},
) {
  const cropped = new Set(records.map((r) => r.relative_path));
  const skipped = new Set(Object.values(skipMap).map((r) => r.relative_path));
  const pending = allImages.filter((img) => !cropped.has(img.relative_path) && !skipped.has(img.relative_path));

  if (pending.length === 0) {
    return { pending, selectedIndex: -1 };
  }

  const last = records[records.length - 1];
  if (!last) {
    return { pending, selectedIndex: 0 };
  }

  const lastFullIndex = allImages.findIndex((img) => img.relative_path === last.relative_path);

  if (lastFullIndex >= 0) {
    for (let i = lastFullIndex + 1; i < allImages.length; i++) {
      if (!cropped.has(allImages[i].relative_path) && !skipped.has(allImages[i].relative_path)) {
        const pendingIndex = pending.findIndex((img) => img.relative_path === allImages[i].relative_path);
        return { pending, selectedIndex: pendingIndex >= 0 ? pendingIndex : 0 };
      }
    }
  }

  return { pending, selectedIndex: 0 };
}

function filterImages(
  all: ImageEntry[],
  records: Record<string, CropRecord[]>,
  skipMap: Record<string, SkipRecord>,
  filter: StatusFilter
): ImageEntry[] {
  const croppedRel = new Set(Object.values(records).flat().map((r) => r.relative_path));
  const skippedRel = new Set(Object.values(skipMap).map((r) => r.relative_path));
  const isCropped = (img: ImageEntry) => croppedRel.has(img.relative_path);
  const isSkipped = (img: ImageEntry) => skippedRel.has(img.relative_path);
  if (filter === 'all') return all;
  if (filter === 'cropped') return all.filter(isCropped);
  if (filter === 'skipped') return all.filter(isSkipped);
  if (filter === 'uncropped') return all.filter((img) => !isCropped(img) && !isSkipped(img));
  return all;
}

function computeVisibleImages(
  all: ImageEntry[],
  records: Record<string, CropRecord[]>,
  skipMap: Record<string, SkipRecord>,
  filter: StatusFilter,
  search: string,
  category: string,
  lock: { sourcePath: string; index: number } | null
): ImageEntry[] {
  let list = filterImages(all, records, skipMap, filter);
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter(
      (i) =>
        i.filename.toLowerCase().includes(q) ||
        i.relative_path.toLowerCase().includes(q)
    );
  }
  if (category !== 'all') {
    list = list.filter((i) => i.relative_path.startsWith(category + '/'));
  }
  if (lock && filter === 'uncropped') {
    const locked = list.find((img) => img.source_path === lock.sourcePath);
    if (!locked) {
      const fromAll = all.find((img) => img.source_path === lock.sourcePath);
      if (fromAll) {
        const insertAt = Math.min(lock.index, list.length);
        list = [...list.slice(0, insertAt), fromAll, ...list.slice(insertAt)];
      }
    }
  }
  return list;
}

export default function App() {
  const [allImages, setAllImages] = useState<ImageEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [settings, setSettings] = useState<Settings>({ source_dir: '', output_dir: '' });
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [showCropped, setShowCropped] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('uncropped');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [croppedGalleryOpen, setCroppedGalleryOpen] = useState(false);
  const [cropRecords, setCropRecords] = useState<Record<string, CropRecord[]>>({});
  const [skipRecords, setSkipRecords] = useState<Record<string, SkipRecord>>({});
  const [loading, setLoading] = useState(false);
  const [continueCropLock, setContinueCropLock] = useState<{ sourcePath: string; index: number } | null>(null);
  const flatCropRecords = useMemo(() => Object.values(cropRecords).flat(), [cropRecords]);

  const images = useMemo(
    () => computeVisibleImages(allImages, cropRecords, skipRecords, statusFilter, search, category, continueCropLock),
    [allImages, cropRecords, skipRecords, statusFilter, search, category, continueCropLock]
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const img of allImages) {
      const first = img.relative_path.split('/')[0];
      if (first) set.add(first);
    }
    return Array.from(set).sort();
  }, [allImages]);

  const [recropTarget, setRecropTarget] = useState<CropRecord | null>(null);
  const [recropCompare, setRecropCompare] = useState<{
    oldRecord: CropRecord;
    preview: CropPreview;
    cropRequest: SaveCropRequest;
  } | null>(null);
  const [recropImage, setRecropImage] = useState<ImageEntry | null>(null);
  const [preRecropCategory, setPreRecropCategory] = useState<string>('all');
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
  }, [settings.source_dir, settings.output_dir, includeNsfw]);

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

  const handleImportComplete = useCallback(async () => {
    const records = await readCropRecords();
    const skipMap = await loadSkipRecords();
    setCropRecords(groupBySourcePath(records));
    setSkipRecords(skipMap);
  }, [loadSkipRecords]);

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
      setSkipRecords(skipMap);
      setContinueCropLock(null);

      const { pending, selectedIndex: resumeIdx } = getResumeImages(imgs, records, skipMap);

      const visible = computeVisibleImages(imgs, grouped, skipMap, statusFilter, search, category, continueCropLock);

      if (statusFilter === 'uncropped') {
        if (resumeIdx >= 0 && pending[resumeIdx]) {
          const targetRel = pending[resumeIdx].relative_path;
          const idx = visible.findIndex((i) => i.relative_path === targetRel);
          setSelectedIndex(idx >= 0 ? idx : (visible.length > 0 ? 0 : -1));
        } else {
          setSelectedIndex(visible.length > 0 ? 0 : -1);
        }
      } else {
        setSelectedIndex(visible.length > 0 ? 0 : -1);
      }
    } finally {
      setLoading(false);
    }
  }, [includeNsfw, statusFilter, search, category, loadSkipRecords]);

  const handleScan = useCallback(() => {
    performScan(settings);
  }, [performScan, settings]);

  const handleSettingsChange = useCallback((s: Settings) => {
    setSettings(s);
    const sourceChanged = s.source_dir !== settings.source_dir;
    if (sourceChanged) {
      setAllImages([]);
      setSelectedIndex(-1);
      setCropRecords({});
      setSkipRecords({});
      setSearch('');
      setCategory('all');
      setContinueCropLock(null);
    }
  }, [settings.source_dir]);

  function exitRecropMode() {
    setRecropImage(null);
    setRecropTarget(null);
    setRecropCompare(null);
  }

  const handleSelect = useCallback((index: number) => {
    setContinueCropLock(null);
    exitRecropMode();
    setSelectedIndex(index);
  }, []);

  function getNextStateAfterSave(
    currentImages: ImageEntry[],
    record: CropRecord,
    currentSelectedIndex: number,
    filter: StatusFilter
  ): { images: ImageEntry[]; selectedIndex: number } {
    if (currentImages.length === 0) {
      return { images: [], selectedIndex: -1 };
    }

    const idx = currentImages.findIndex(
      (img) =>
        img.source_path === record.source_path ||
        img.relative_path === record.relative_path
    );
    const fallbackIdx =
      idx >= 0
        ? idx
        : Math.min(Math.max(0, currentSelectedIndex), currentImages.length - 1);

    if (filter === 'uncropped') {
      const nextImages = currentImages.filter(
        (img) =>
          img.source_path !== record.source_path &&
          img.relative_path !== record.relative_path
      );
      if (nextImages.length === 0) {
        return { images: [], selectedIndex: -1 };
      }
      const nextIndex =
        fallbackIdx < nextImages.length ? fallbackIdx : nextImages.length - 1;
      return { images: nextImages, selectedIndex: nextIndex };
    }

    // all / cropped / skipped：不改列表，优先下一张，末尾回退
    const nextIndex =
      fallbackIdx + 1 < currentImages.length
        ? fallbackIdx + 1
        : Math.max(0, fallbackIdx - 1);
    return { images: currentImages, selectedIndex: nextIndex };
  }

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
    setContinueCropLock(null);
    addCropRecord(record);
    const { selectedIndex: nextIdx } = getNextStateAfterSave(
      images,
      record,
      selectedIndex,
      statusFilter
    );
    setSelectedIndex(nextIdx);
  }, [addCropRecord, images, selectedIndex, statusFilter]);

  const handleSaveAndContinueCrop = useCallback((record: CropRecord) => {
    addCropRecord(record);
    setContinueCropLock({ sourcePath: record.source_path, index: selectedIndex });
  }, [addCropRecord, selectedIndex]);

  const handleDeleteImage = useCallback((sourcePath: string) => {
    setContinueCropLock(null);
    setAllImages((prev) => prev.filter((i) => i.source_path !== sourcePath));
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
    // images auto-updates via useMemo, selectedIndex corrected by effect
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
      return groupBySourcePath(nextFlat);
    });
    // images auto-updates, selectedIndex corrected by effect
  }, []);

  const gridSelectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;
  const selectedImage = recropImage ?? gridSelectedImage;

  useEffect(() => {
    if (selectedIndex < 0) return;

    const next = images[selectedIndex + 1];
    if (next) preloadPreview(next.source_path);

    const prev = images[selectedIndex - 1];
    if (prev) preloadPreview(prev.source_path);
  }, [images, selectedIndex]);

  useEffect(() => {
    if (images.length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex < 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= images.length) {
      setSelectedIndex(images.length - 1);
    }
  }, [images.length, selectedIndex]);

  useEffect(() => {
    setContinueCropLock(null);
  }, [statusFilter, search, category]);

  const startRecrop = useCallback(async (record: CropRecord) => {
    try {
      const entry = await resolveOriginalForRecord(record);
      const entryCategory = entry.relative_path.split('/')[0] || 'all';
      setPreRecropCategory(entryCategory);
      setAllImages((prev) => {
        const exists = prev.some((i) => i.relative_path === entry.relative_path);
        return exists ? prev : [...prev, entry];
      });
      setRecropImage(entry);
      setRecropTarget(record);
      setCroppedGalleryOpen(false);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }, []);

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

  const handleConfirmRecrop = useCallback(async (request: SaveCropRequest) => {
    if (!recropTarget) return;
    try {
      await saveRecrop({
        old_output_path: recropTarget.output_path,
        crop: request,
      });
      const records = await readCropRecords();
      const nextGrouped = groupBySourcePath(records);
      setCropRecords(nextGrouped);

      setRecropImage(null);
      setStatusFilter('uncropped');
      setShowCropped(false);
      setSearch('');
      setContinueCropLock(null);
      setCategory(preRecropCategory);

      const nextImages = computeVisibleImages(
        allImages,
        nextGrouped,
        skipRecords,
        'uncropped',
        '',
        preRecropCategory,
        null
      );
      setSelectedIndex(nextImages.length > 0 ? 0 : -1);

      setRecropTarget(null);
      setRecropCompare(null);
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)));
    }
  }, [recropTarget, allImages, skipRecords, preRecropCategory]);

  const handleSkipImage = useCallback(async () => {
    if (!selectedImage) return;
    setContinueCropLock(null);
    const skippedSourcePath = selectedImage.source_path;
    const skippedRelativePath = selectedImage.relative_path;
    const record = await skipImage(skippedSourcePath);
    setSkipRecords((prev) => ({
      ...prev,
      [record.source_path]: record,
      [skippedSourcePath]: record,
    }));
    // Compute next images to check if selectedIndex needs adjustment
    const nextSkipRecords = {
      ...skipRecords,
      [record.source_path]: record,
      [skippedSourcePath]: record,
    };
    const nextImages = computeVisibleImages(
      allImages,
      cropRecords,
      nextSkipRecords,
      statusFilter,
      search,
      category,
      null
    );
    if (selectedIndex >= nextImages.length) {
      setSelectedIndex(nextImages.length > 0 ? nextImages.length - 1 : -1);
    }
  }, [selectedImage, selectedIndex, allImages, cropRecords, skipRecords, statusFilter, search, category]);

  const handleCancelRecrop = useCallback(() => {
    exitRecropMode();
    setCroppedGalleryOpen(true);
  }, []);

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
            }}
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
            categories={categories}
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
              onPrev={() => {
                setContinueCropLock(null);
                exitRecropMode();
                setSelectedIndex((i) => Math.max(0, i - 1));
              }}
              onNext={() => {
                setContinueCropLock(null);
                exitRecropMode();
                setSelectedIndex((i) => Math.min(images.length - 1, i + 1));
              }}
              settings={settings}
              ratioMode={lastRatioMode}
              onRatioModeChange={handleRatioModeChange}
              recropTarget={recropTarget}
              onPreviewRecrop={handlePreviewRecrop}
              onCancelRecrop={handleCancelRecrop}
              onConfirmRecrop={handleConfirmRecrop}
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
          records={flatCropRecords}
          onClose={() => setCroppedGalleryOpen(false)}
          onRecrop={startRecrop}
          onDeleteCropRecord={handleDeleteCropRecord}
        />
      )}
      {recropCompare && (
        <RecropCompareModal
          oldRecord={recropCompare.oldRecord}
          preview={recropCompare.preview}
          onConfirm={() => handleConfirmRecrop(recropCompare.cropRequest)}
          onAdjust={() => setRecropCompare(null)}
          onCancel={handleCancelRecrop}
        />
      )}
    </div>
  );
}
