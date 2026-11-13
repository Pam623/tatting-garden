// Patterns drawn on the board, kept in this browser only. Each has its own key, so one damaged entry
// can't lose the others, and a full or blocked storage is an answer rather than a crash.
import { structureProblems } from './pattern.js';

const DRAWING_PREFIX = 'drawing:';
const DRAWING_ID = /^draw-[\w-]+$/;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function newDrawingId(now = Date.now()) {
  return `draw-${now.toString(36)}`;
}

function readDrawing(storage, key) {
  try {
    const entry = JSON.parse(storage.getItem(key));
    const usable = entry?.pattern && entry.pattern.id === key.slice(DRAWING_PREFIX.length)
      && DRAWING_ID.test(entry.pattern.id) && structureProblems(entry.pattern).length === 0;
    return usable ? { id: entry.pattern.id, savedAt: entry.savedAt, pattern: entry.pattern } : null;
  } catch {
    return null;
  }
}

// Newest first. available is false when the browser won't let this page read its storage at all.
export function listDrawings(storage = browserStorage()) {
  if (!storage) return { available: false, drawings: [] };
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAWING_PREFIX)) keys.push(key);
    }
    const drawings = keys.map((key) => readDrawing(storage, key)).filter(Boolean);
    drawings.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return { available: true, drawings };
  } catch {
    return { available: false, drawings: [] };
  }
}

// False when it could not be kept: storage full, or blocked.
export function saveDrawing(pattern, storage = browserStorage(), now = new Date()) {
  if (!storage) return false;
  try {
    storage.setItem(`${DRAWING_PREFIX}${pattern.id}`, JSON.stringify({ savedAt: now.toISOString(), pattern }));
    return true;
  } catch {
    return false;
  }
}

export const TITLE_MAX = 20;

// A name typed for a drawing: spaces tidied, at most TITLE_MAX characters; null when nothing is left.
export function cleanTitle(text) {
  const tidy = String(text ?? '').replace(/\s+/g, ' ').trim();
  return tidy ? [...tidy].slice(0, TITLE_MAX).join('') : null;
}

// Gives a saved drawing a new name and keeps its date. Returns the renamed pattern, or null if it could not.
export function renameDrawing(id, text, storage = browserStorage()) {
  const title = cleanTitle(text);
  if (!storage || !title) return null;
  try {
    const key = `${DRAWING_PREFIX}${id}`;
    const entry = readDrawing(storage, key);
    if (!entry) return null;
    const pattern = { ...entry.pattern, title };
    storage.setItem(key, JSON.stringify({ savedAt: entry.savedAt, pattern }));
    return pattern;
  } catch {
    return null;
  }
}

// Takes the place reached in work mode with it.
export function deleteDrawing(id, storage = browserStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(`${DRAWING_PREFIX}${id}`);
    storage.removeItem(`work:${id}`);
    return true;
  } catch {
    return false;
  }
}
