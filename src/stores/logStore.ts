// [SPEC-14.3] Visible activity log: device connections, sample-bank status and
// Strudel warnings (e.g. "sound X not found") surfaced in the UI, not just the
// console.

import { writable } from 'svelte/store';

export type NoticeLevel = 'info' | 'success' | 'warn' | 'error';

export interface Notice {
  id: number;
  level: NoticeLevel;
  text: string;
}

export const notices = writable<Notice[]>([]);

/** Transient toasts (top of the screen) — for warn/error, which would otherwise
 *  be missed in the journal at the bottom of the page. [SPEC-17.26] */
export const toasts = writable<Notice[]>([]);

let seq = 0;
const TOAST_MS = 6000;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Add a visible notice (keeps the last 10, most recent first). Warn/error also
 *  pop a transient toast so they are seen without scrolling. */
export function notify(level: NoticeLevel, text: string): void {
  notices.update((list) => [{ id: seq++, level, text }, ...list.filter((n) => n.text !== text)].slice(0, 10));
  if (level === 'warn' || level === 'error') pushToast(level, text);
}

function pushToast(level: NoticeLevel, text: string): void {
  const id = seq++;
  toasts.update((list) => {
    // Dedupe by text: drop an existing same-text toast (and its timer) first.
    const existing = list.find((t) => t.text === text);
    if (existing) {
      const timer = toastTimers.get(existing.id);
      if (timer) clearTimeout(timer);
      toastTimers.delete(existing.id);
    }
    return [...list.filter((t) => t.text !== text), { id, level, text }];
  });
  if (typeof setTimeout !== 'undefined') {
    toastTimers.set(id, setTimeout(() => dismissToast(id), TOAST_MS));
  }
}

export function dismissToast(id: number): void {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export function clearNotices(): void {
  notices.set([]);
}

let logCaptureStarted = false;

/** Capture Strudel's internal warnings (missing/unloaded sounds, eval errors). */
export function initLogCapture(): void {
  if (logCaptureStarted || typeof document === 'undefined') return;
  logCaptureStarted = true;
  document.addEventListener('strudel.log', (event: Event) => {
    const message = (event as CustomEvent).detail?.message as string | undefined;
    if (!message) return;
    if (/not found|not loaded|error/i.test(message)) notify('warn', message);
  });
}
