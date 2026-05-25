import { useState, useCallback, useEffect, useRef } from 'react';
import { ensureCroppedThumbnails } from '../../api';
import { ThumbEntry } from './types';
import { CropRecord } from '../../api';

const BATCH_SIZE = 12;
const CONCURRENCY = 4;

export function useCroppedThumbQueue() {
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
          if (generationRef.current !== gen) return;
          for (const key of keys) {
            loadingRef.current.delete(key);
          }
          runningRef.current = Math.max(0, runningRef.current - 1);
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
    generationRef.current++;
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

  return { thumbs, loadThumb };
}
