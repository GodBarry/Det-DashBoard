import { useEffect, useRef, useState } from "react";

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_CACHE_ENTRIES = 192;
const imageCache = new Map();
const pendingImages = new Map();

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

export function loadAuthenticatedImage(src) {
  if (!src) return Promise.resolve("");
  const key = cacheKey(src);
  const cached = imageCache.get(key);
  if (cached) return Promise.resolve(remember(key, cached));
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
  return loadAuthenticatedImage(src).catch(() => "");
}

export function AuthenticatedImage({ src, placeholderSrc, onError, onSourceReady, ...props }) {
  const [objectUrl, setObjectUrl] = useState("");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSourceReadyRef = useRef(onSourceReady);
  onSourceReadyRef.current = onSourceReady;

  useEffect(() => {
    let active = true;
    if (!src) {
      setObjectUrl("");
      return () => { active = false; };
    }

    if (!objectUrl && placeholderSrc) {
      loadAuthenticatedImage(placeholderSrc).then((placeholderUrl) => {
        if (active) setObjectUrl((current) => current || placeholderUrl);
      }).catch(() => {});
    }

    loadAuthenticatedImage(src)
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
    };
  }, [src, placeholderSrc]);

  return <img {...props} src={objectUrl || TRANSPARENT_PIXEL} />;
}

export default AuthenticatedImage;
