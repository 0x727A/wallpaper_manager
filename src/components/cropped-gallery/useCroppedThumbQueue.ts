import { useState, useCallback, useEffect, useRef } from 'react';
import { ensureCroppedThumbnails } from '../../api';
import { ThumbEntry } from './types';
import { CropRecord } from '../../api';

const BATCH_SIZE = 12;
const CONCURRENCY = 4;

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
      ensureCroppedThumbnails(keys)
        .then((map) => {
          if (generationRef.current !== gen) return;
          for (const key of keys) {
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
            loadedRef.current.add(key);
            pendingThumbsRef.current[key] = { path: '', failed: true };
          }
        })
        .finally(() => {
          for (const key of keys) {
            loadingRef.current.delete(key);
          }
          runningRef.current = Math.max(0, runningRef.current - 1);

          if (generationRef.current !== gen || disposedRef.current) return;

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
    queueRef.current.push(record);
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
    generationRef.current++;
    const validKeys = new Set(records?.map((r) => r.output_path) ?? []);

    for (const key of Array.from(loadedRef.current)) {
      if (!validKeys.has(key)) loadedRef.current.delete(key);
    }
    for (const key of Array.from(queuedRef.current)) {
      if (!validKeys.has(key)) queuedRef.current.delete(key);
    }
    for (const key of Array.from(loadingRef.current)) {
      if (!validKeys.has(key)) loadingRef.current.delete(key);
    }
    queueRef.current = queueRef.current.filter((r) => validKeys.has(r.output_path));
    for (const key of Object.keys(pendingThumbsRef.current)) {
      if (!validKeys.has(key)) delete pendingThumbsRef.current[key];
    }

    setThumbs((prev) => {
      const next: Record<string, ThumbEntry> = {};
      let changed = false;
      for (const key of Object.keys(prev)) {
        if (validKeys.has(key)) {
          next[key] = prev[key];
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [records]);

  return { thumbs, loadThumb };
}
