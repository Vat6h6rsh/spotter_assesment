import { useSyncExternalStore } from "react";
import { forcedDemo } from "../api/client";
const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
export const WAKE_CHIP_DELAY_MS = 1500;
export const WAKE_TIMEOUT_MS = 65000;
export interface ServerWakeState {
  status: "idle" | "waking" | "ready" | "unavailable";
  slow: boolean;
  startedAt: number | null;
}
let current: ServerWakeState = { status: "idle", slow: false, startedAt: null };
let owners = 0;
let active: { controller: AbortController; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
function publish(next: ServerWakeState) {
  current = next;
  listeners.forEach((listener) => listener());
}
function begin(): Promise<void> {
  if (active) return active.promise;
  if (current.status === "ready" || current.status === "unavailable") return Promise.resolve();
  if (forcedDemo) {
    publish({ status: "ready", slow: false, startedAt: null });
    return Promise.resolve();
  }
  const controller = new AbortController();
  const startedAt = Date.now();
  publish({ status: "waking", slow: false, startedAt });
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  active = { controller, promise };
  let attempt: AbortController | null = null;
  const finish = (status: "ready" | "unavailable" | "idle") => {
    clearTimeout(slowTimer);
    clearTimeout(timeout);
    clearInterval(retries);
    attempt?.abort();
    if (active?.controller === controller) {
      active = null;
      publish({ status, slow: false, startedAt: status === "idle" ? null : startedAt });
    }
    resolve();
  };
  const poll = () => {
    if (controller.signal.aborted || active?.controller !== controller) return;
    attempt?.abort();
    const request = new AbortController();
    attempt = request;
    void fetch(`${API_BASE}/api/health`, { method: "GET", cache: "no-store", signal: request.signal })
      .then((response) => {
        if (response.ok && !request.signal.aborted && active?.controller === controller) finish("ready");
      }).catch(() => { /* Transient hosting/network failures retry within the overall deadline. */ });
  };
  const slowTimer = setTimeout(() => {
    if (active?.controller === controller) publish({ status: "waking", slow: true, startedAt });
  }, WAKE_CHIP_DELAY_MS);
  const timeout = setTimeout(() => finish("unavailable"), WAKE_TIMEOUT_MS);
  const retries = setInterval(poll, 3000);
  controller.signal.addEventListener("abort", () => finish("idle"), { once: true });
  // StrictMode setup/cleanup/setup shares one request.
  void Promise.resolve().then(poll);
  return promise;
}
export const serverWake = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  start() {
    owners++;
    void begin();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      owners--;
      queueMicrotask(() => {
        if (!owners) active?.controller.abort();
      });
    };
  },
  retry() {
    if (current.status === "unavailable") {
      publish({ status: "idle", slow: false, startedAt: null });
      return begin();
    }
    return active?.promise ?? Promise.resolve();
  },
  /**
   * Queue a submitted trip until this wake attempt settles. Submitting after a failed wake counts as Try again;
   * a second failure releases the trip so the request itself reports the error (or the labelled demo fallback).
   */
  wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (current.status === "unavailable") void serverWake.retry();
    else void begin();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { listeners.delete(check); signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new DOMException("Request cancelled", "AbortError")); };
      const check = () => { if (current.status === "ready" || current.status === "unavailable") { cleanup(); resolve(); } };
      listeners.add(check);
      signal.addEventListener("abort", abort, { once: true });
      check();
    });
  },
};
export const useServerWake = () => useSyncExternalStore(serverWake.subscribe, serverWake.get, serverWake.get);
