import { memo, useEffect, useRef, useState } from "react";

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_CACHE_ENTRIES = 192;
const imageCache = new Map();
const pendingImages = new Map();
const preloadQueue = new Set();
let preloadScheduled = false;

function cacheKey(src) {
  let scope = "anonymous";
  try {
    const user = JSON.parse(localStorage.getItem("det-dashboard-user") || "{}");
    scope = user.sessionId || user.id || scope;
  } catch {}
  return `${scope}:${src}`;
}

function remember(key, objectUrl) {
  imageCache.delete(key);
  imageCache.set(key, objectUrl);
  while (imageCache.size > MAX_CACHE_ENTRIES) {
    const oldest = imageCache.keys().next().value;
    URL.revokeObjectURL(imageCache.get(oldest));
    imageCache.delete(oldest);
  }
  return objectUrl;
}

export function loadAuthenticatedImage(src, options = {}) {
  if (!src) return Promise.resolve("");
  const key = cacheKey(src);
  const cached = imageCache.get(key);
  if (cached) return Promise.resolve(remember(key, cached));
  // Viewer requests are cancellable and must not share a low-priority preload.
  if (options.signal) {
    return fetch(src, { signal: options.signal, cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Image request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => remember(key, URL.createObjectURL(blob)));
  }
  if (pendingImages.has(key)) return pendingImages.get(key);

  const request = fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error(`Image request failed (${response.status})`);
      return response.blob();
    })
    .then((blob) => remember(key, URL.createObjectURL(blob)))
    .finally(() => pendingImages.delete(key));
  pendingImages.set(key, request);
  return request;
}

export function preloadAuthenticatedImage(src) {
  if (!src || preloadQueue.has(src)) return Promise.resolve("");
  preloadQueue.add(src);
  const run = () => {
    preloadQueue.delete(src);
    preloadScheduled = false;
    return loadAuthenticatedImage(src).catch(() => "");
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return new Promise((resolve) => window.requestIdleCallback(() => resolve(run()), { timeout: 350 }));
  }
  return new Promise((resolve) => window.setTimeout(() => resolve(run()), 120));
}

export const AuthenticatedImage = memo(function AuthenticatedImage({ src, placeholderSrc, onError, onSourceReady, ...props }) {
  const [objectUrl, setObjectUrl] = useState("");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSourceReadyRef = useRef(onSourceReady);
  onSourceReadyRef.current = onSourceReady;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!src) {
      setObjectUrl("");
      return () => { active = false; };
    }

    if (!objectUrl && placeholderSrc) {
      loadAuthenticatedImage(placeholderSrc).then((placeholderUrl) => {
        if (active) setObjectUrl((current) => current || placeholderUrl);
      }).catch(() => {});
    }

    loadAuthenticatedImage(src, { signal: controller.signal })
      .then((nextObjectUrl) => {
        if (active) {
          setObjectUrl(nextObjectUrl);
          onSourceReadyRef.current?.();
        }
      })
      .catch((error) => {
        if (active) onErrorRef.current?.(error);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [src, placeholderSrc]);

  return <img {...props} src={objectUrl || TRANSPARENT_PIXEL} />;
}, (previous, next) => previous.src === next.src && previous.placeholderSrc === next.placeholderSrc && previous.alt === next.alt && previous.className === next.className);

export default AuthenticatedImage;
