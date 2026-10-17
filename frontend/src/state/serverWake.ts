import { useSyncExternalStore } from "react";
import { forcedDemo } from "../api/client";

// Keep normalization identical to the API client, including same-origin deployments.
const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://localhost:8000"
).replace(/\/$/, "");
export const WAKE_CHIP_DELAY_MS = 1500;
export const WAKE_TIMEOUT_MS = 65000;
export interface ServerWakeState {
  status: "idle" | "waking" | "ready" | "unavailable";
  slow: boolean;
}

let current: ServerWakeState = { status: "idle", slow: false };
let owners = 0;
let active: { controller: AbortController; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
function publish(next: ServerWakeState) {
  current = next;
  listeners.forEach((listener) => listener());
}

function begin() {
  if (active) return active.promise;
  if (current.status === "ready" || current.status === "unavailable")
    return Promise.resolve();
  if (forcedDemo) {
    publish({ status: "ready", slow: false });
    return Promise.resolve();
  }
  const controller = new AbortController();
  publish({ status: "waking", slow: false });
  const slowTimer = setTimeout(() => {
    if (active?.controller === controller)
      publish({ status: "waking", slow: true });
  }, WAKE_CHIP_DELAY_MS);
  const timeout = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS);
  // Start in a microtask so StrictMode's setup/cleanup/setup shares one request.
  const promise = Promise.resolve()
    .then(async () => {
      controller.signal.throwIfAborted();
      const response = await fetch(`${API_BASE}/api/health`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (active?.controller === controller)
        publish({ status: response.ok ? "ready" : "unavailable", slow: false });
    })
    .catch(() => {
      if (active?.controller === controller)
        publish({ status: "unavailable", slow: false });
    })
    .finally(() => {
      clearTimeout(slowTimer);
      clearTimeout(timeout);
      if (active?.controller === controller) active = null;
    });
  active = { controller, promise };
  return promise;
}

export const serverWake = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Use once in the root effect; its cleanup cancels work after the last owner leaves. */
  start() {
    owners++;
    void begin();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      owners--;
      queueMicrotask(() => {
        if (owners || !active) return;
        const abandoned = active;
        active = null;
        abandoned.controller.abort();
        publish({ status: "idle", slow: false });
      });
    };
  },
  /** A cancelled plan stops waiting without cancelling the app's background health request. */
  wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const promise = begin();
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Request cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(() => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
        else resolve();
      });
    });
  },
};

export const useServerWake = () =>
  useSyncExternalStore(serverWake.subscribe, serverWake.get, serverWake.get);
