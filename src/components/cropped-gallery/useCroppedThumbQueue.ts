import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ensureCroppedThumbnails } from '../../api';
import { ThumbEntry } from './types';
import { CropRecord } from '../../api';

const BATCH_SIZE = 1;
const CONCURRENCY = 4;
const THUMB_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('缩略图生成超时'));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function useCroppedThumbQueue(records?: CropRecord[]) {
  const [thumbs, setThumbs] = useState<Record<string, ThumbEntry>>({});

  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Set<string>>(new Set());
  const pendingThumbsRef = useRef<Record<string, ThumbEntry>>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<CropRecord[]>([]);
  const runningRef = useRef(0);
  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const validKeysRef = useRef<Set<string>>(new Set());
  const validKeys = useMemo(() => new Set(records?.map((r) => r.output_path) ?? []), [records]);
  validKeysRef.current = validKeys;

  const flushThumbs = useCallback(() => {
    if (disposedRef.current) return;
    if (flushTimeoutRef.current !== null) return;
    flushTimeoutRef.current = setTimeout(() => {
      flushTimeoutRef.current = null;
      if (disposedRef.current) return;
      if (Object.keys(pendingThumbsRef.current).length > 0) {
        setThumbs((prev) => ({ ...prev, ...pendingThumbsRef.current }));
        pendingThumbsRef.current = {};
      }
    }, 50);
  }, []);

  const scheduleLoad = useCallback(() => {
    const gen = generationRef.current;
    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const batch: CropRecord[] = [];
      const keys: string[] = [];
      while (batch.length < BATCH_SIZE && queueRef.current.length > 0) {
        const record = queueRef.current.shift()!;
        const key = record.output_path;
        queuedRef.current.delete(key);
        if (loadedRef.current.has(key) || loadingRef.current.has(key)) {
          continue;
        }
        batch.push(record);
        keys.push(key);
        loadingRef.current.add(key);
      }
      if (keys.length === 0) continue;

      runningRef.current++;
      withTimeout(ensureCroppedThumbnails(keys), THUMB_TIMEOUT_MS)
        .then((map) => {
          if (generationRef.current !== gen) return;
          for (const key of keys) {
            if (!validKeysRef.current.has(key)) continue;
            loadedRef.current.add(key);
            if (map[key]) {
              pendingThumbsRef.current[key] = { path: map[key], failed: false };
            } else {
              pendingThumbsRef.current[key] = { path: '', failed: true };
            }
          }
        })
        .catch((err) => {
          console.error('ensureCroppedThumbnails failed', keys, err);
          if (generationRef.current !== gen) return;
          for (const key of keys) {
            if (!validKeysRef.current.has(key)) continue;
            loadedRef.current.add(key);
            pendingThumbsRef.current[key] = { path: '', failed: true };
          }
        })
        .finally(() => {
          for (const key of keys) {
            loadingRef.current.delete(key);
          }
          runningRef.current = Math.max(0, runningRef.current - 1);

          if (disposedRef.current) return;

          flushThumbs();
          scheduleLoad();
        });
    }
  }, [flushThumbs]);

  const loadThumb = useCallback((record: CropRecord) => {
    const key = record.output_path;
    if (loadedRef.current.has(key) || loadingRef.current.has(key) || queuedRef.current.has(key))
      return;
    queuedRef.current.add(key);
    queueRef.current.unshift(record);
    scheduleLoad();
  }, [scheduleLoad]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      generationRef.current++;
      disposedRef.current = true;
      setThumbs({});
      loadedRef.current.clear();
      loadingRef.current.clear();
      queuedRef.current.clear();
      queueRef.current = [];
      runningRef.current = 0;
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      pendingThumbsRef.current = {};
    };
  }, []);

  useEffect(() => {
    for (const key of Array.from(loadedRef.current)) {
      if (!validKeysRef.current.has(key)) loadedRef.current.delete(key);
    }
    for (const key of Array.from(queuedRef.current)) {
      if (!validKeysRef.current.has(key)) queuedRef.current.delete(key);
    }
    for (const key of Array.from(loadingRef.current)) {
      if (!validKeysRef.current.has(key)) loadingRef.current.delete(key);
    }
    queueRef.current = queueRef.current.filter((r) => validKeysRef.current.has(r.output_path));
    for (const key of Object.keys(pendingThumbsRef.current)) {
      if (!validKeysRef.current.has(key)) delete pendingThumbsRef.current[key];
    }

    setThumbs((prev) => {
      const next: Record<string, ThumbEntry> = {};
      let changed = false;
      for (const key of Object.keys(prev)) {
        if (validKeysRef.current.has(key)) {
          next[key] = prev[key];
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [validKeys]);

  return { thumbs, loadThumb };
}
