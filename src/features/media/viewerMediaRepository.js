import { useEffect, useSyncExternalStore } from "react";

import { preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

const EMPTY_ANNOTATIONS = Object.freeze([]);
const MAX_ANNOTATION_ENTRIES = 1024;
const annotationCache = new Map();
const annotationListeners = new Map();
const pendingCurrent = new Map();
const pendingBatchIds = new Set();
const queuedBatchIds = new Map();
const batchTimers = new Map();
const activeBatches = new Map();

function rememberAnnotations(imageId, annotations) {
  const rows = Array.isArray(annotations) ? annotations : EMPTY_ANNOTATIONS;
  annotationCache.delete(imageId);
  annotationCache.set(imageId, rows);
  while (annotationCache.size > MAX_ANNOTATION_ENTRIES) annotationCache.delete(annotationCache.keys().next().value);
  for (const listener of annotationListeners.get(imageId) || []) listener();
  return rows;
}

function subscribeAnnotations(imageId, listener) {
  if (!imageId) return () => {};
  if (!annotationListeners.has(imageId)) annotationListeners.set(imageId, new Set());
  annotationListeners.get(imageId).add(listener);
  return () => {
    const listeners = annotationListeners.get(imageId);
    listeners?.delete(listener);
    if (!listeners?.size) annotationListeners.delete(imageId);
  };
}

function annotationSnapshot(imageId) {
  return annotationCache.get(imageId) || EMPTY_ANNOTATIONS;
}

export function loadCurrentAnnotations(imageId) {
  if (!imageId || annotationCache.has(imageId)) return Promise.resolve(annotationSnapshot(imageId));
  if (pendingCurrent.has(imageId)) return pendingCurrent.get(imageId);
  if (pendingBatchIds.has(imageId) || [...queuedBatchIds.values()].some((ids) => ids.has(imageId))) {
    return new Promise((resolve) => window.setTimeout(resolve, 180)).then(() => loadCurrentAnnotations(imageId));
  }
  const request = fetch(`/api/project-images/${imageId}/annotations`, { priority: "high" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载图片标注失败")))
    .then((data) => rememberAnnotations(imageId, data.annotations))
    .finally(() => pendingCurrent.delete(imageId));
  pendingCurrent.set(imageId, request);
  return request;
}

function scheduleBatch(projectId, delay = 45) {
  if (batchTimers.has(projectId) || activeBatches.has(projectId)) return;
  batchTimers.set(projectId, window.setTimeout(() => {
    batchTimers.delete(projectId);
    flushAnnotationBatch(projectId);
  }, delay));
}

function flushAnnotationBatch(projectId) {
  if (activeBatches.has(projectId)) return activeBatches.get(projectId);
  const queue = queuedBatchIds.get(projectId);
  const ids = [...(queue || [])].filter((id) => !annotationCache.has(id) && !pendingBatchIds.has(id)).slice(0, 32);
  ids.forEach((id) => queue.delete(id));
  if (!ids.length) return Promise.resolve();
  ids.forEach((id) => pendingBatchIds.add(id));
  const request = fetch(`/api/projects/${projectId}/image-annotations/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageIds: ids }),
  })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("批量加载图片标注失败")))
    .then((data) => {
      const rows = data.annotationsByImage || {};
      ids.forEach((id) => rememberAnnotations(id, rows[id]));
    })
    .finally(() => {
      ids.forEach((id) => pendingBatchIds.delete(id));
      activeBatches.delete(projectId);
      if (queuedBatchIds.get(projectId)?.size) scheduleBatch(projectId, 0);
    });
  activeBatches.set(projectId, request);
  return request;
}

export function loadAnnotationWindow(projectId, imageIds) {
  if (!projectId) return Promise.resolve();
  if (!queuedBatchIds.has(projectId)) queuedBatchIds.set(projectId, new Set());
  const queue = queuedBatchIds.get(projectId);
  for (const id of imageIds || []) {
    if (id && !annotationCache.has(id) && !pendingBatchIds.has(id)) queue.add(id);
  }
  scheduleBatch(projectId);
  return activeBatches.get(projectId) || Promise.resolve();
}

export function prefetchViewerWindow({ projectId, items, index, direction = 1, imageSize = 1920 }) {
  const imageForward = direction >= 0 ? 8 : 3;
  const imageBackward = direction >= 0 ? 3 : 8;
  const annotationForward = direction >= 0 ? 24 : 8;
  const annotationBackward = direction >= 0 ? 8 : 24;
  const imageCandidates = [];
  const annotationCandidates = [];
  for (let distance = 1; distance <= Math.max(annotationForward, annotationBackward); distance += 1) {
    if (distance <= annotationForward && items[index + distance]) annotationCandidates.push(items[index + distance]);
    if (distance <= annotationBackward && items[index - distance]) annotationCandidates.push(items[index - distance]);
    if (distance <= imageForward && items[index + distance]) imageCandidates.push(items[index + distance]);
    if (distance <= imageBackward && items[index - distance]) imageCandidates.push(items[index - distance]);
  }
  for (const item of imageCandidates) preloadAuthenticatedImage(`/api/project-images/${item.id}/preview?size=${imageSize}`);
  return loadAnnotationWindow(projectId, annotationCandidates.map((item) => item.id));
}

export function prefetchImageWindow({ items, index, direction = 1, getSource }) {
  const forward = direction >= 0 ? 4 : 2;
  const backward = direction >= 0 ? 2 : 4;
  for (let distance = 1; distance <= Math.max(forward, backward); distance += 1) {
    if (distance <= forward && items[index + distance]) preloadAuthenticatedImage(getSource(items[index + distance]));
    if (distance <= backward && items[index - distance]) preloadAuthenticatedImage(getSource(items[index - distance]));
  }
}

export function setViewerAnnotations(imageId, annotations) {
  if (imageId) rememberAnnotations(imageId, annotations);
}

export function useViewerAnnotations(imageId, inlineAnnotations) {
  const cached = useSyncExternalStore(
    (listener) => subscribeAnnotations(imageId, listener),
    () => annotationSnapshot(imageId),
    () => EMPTY_ANNOTATIONS,
  );
  useEffect(() => {
    if (!imageId) return;
    if (Array.isArray(inlineAnnotations) && !annotationCache.has(imageId)) rememberAnnotations(imageId, inlineAnnotations);
    else loadCurrentAnnotations(imageId).catch(() => {});
  }, [imageId, inlineAnnotations]);
  return cached;
}
