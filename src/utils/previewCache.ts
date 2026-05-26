import { resolvePreviewImage, ResolvedPreview } from '../api';

const MAX_PREVIEW_CACHE = 20;
const cache = new Map<string, ResolvedPreview>();
const inFlight = new Map<string, Promise<ResolvedPreview>>();

function remember(path: string, preview: ResolvedPreview) {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, preview);

  while (cache.size > MAX_PREVIEW_CACHE) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

export function getCachedPreview(path: string): ResolvedPreview | undefined {
  const preview = cache.get(path);
  if (!preview) return undefined;
  cache.delete(path);
  cache.set(path, preview);
  return preview;
}

export function loadPreview(path: string): Promise<ResolvedPreview> {
  const cached = getCachedPreview(path);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(path);
  if (existing) return existing;

  const promise = resolvePreviewImage(path)
    .then((preview) => {
      remember(path, preview);
      return preview;
    })
    .finally(() => {
      inFlight.delete(path);
    });

  inFlight.set(path, promise);
  return promise;
}

export function preloadPreview(path: string) {
  if (cache.has(path) || inFlight.has(path)) return;
  loadPreview(path).catch((err) => {
    console.error('preload preview failed', path, err);
  });
}
