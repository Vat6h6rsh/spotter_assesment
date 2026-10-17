import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function pendingFetch() {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    respond = resolve;
    options.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, respond: (ok = true) => respond({ ok } as Response) };
}

describe("background server wake", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("VITE_USE_MOCK", "0");
    vi.stubEnv("VITE_API_BASE", "https://route.example/");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the configured API base and never shows the chip for a fast response", async () => {
    const request = pendingFetch();
    const { serverWake } = await import("./serverWake");
    const stop = serverWake.start();
    await Promise.resolve();
    expect(request.fetcher).toHaveBeenCalledWith("https://route.example/api/health", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }));
    request.respond();
    await serverWake.wait(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1600);
    expect(serverWake.get()).toMatchObject({ status: "ready", slow: false });
    stop();
  });

  it("delays the calm chip and automatically releases a queued plan when health answers", async () => {
    const request = pendingFetch();
    const { serverWake } = await import("./serverWake");
    const stop = serverWake.start();
    const continuePlan = vi.fn();
    const waiting = serverWake.wait(new AbortController().signal).then(continuePlan);
    await vi.advanceTimersByTimeAsync(1499);
    expect(serverWake.get().slow).toBe(false);
    expect(continuePlan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(serverWake.get()).toMatchObject({ status: "waking", slow: true });
    request.respond();
    await waiting;
    expect(continuePlan).toHaveBeenCalledOnce();
    expect(serverWake.get()).toMatchObject({ status: "ready", slow: false });
    stop();
  });

  it("shares the StrictMode request and aborts it after the final real unmount", async () => {
    const request = pendingFetch();
    const { serverWake } = await import("./serverWake");
    const firstCleanup = serverWake.start();
    firstCleanup();
    const secondCleanup = serverWake.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.fetcher).toHaveBeenCalledOnce();
    const signal = request.fetcher.mock.calls[0][1].signal;
    expect(signal?.aborted).toBe(false);
    secondCleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(serverWake.get()).toMatchObject({ status: "idle", slow: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a queued plan cancel without cancelling background health", async () => {
    const request = pendingFetch();
    const { serverWake } = await import("./serverWake");
    const stop = serverWake.start();
    const controller = new AbortController();
    const waiting = serverWake.wait(controller.signal);
    const cancelled = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelled;
    expect(request.fetcher.mock.calls[0][1].signal?.aborted).toBe(false);
    request.respond();
    await serverWake.wait(new AbortController().signal);
    stop();
  });

  it("retries 503 and network failures every three seconds until OK", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new TypeError("Network")) .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    const { serverWake } = await import("./serverWake");
    const stop = serverWake.start();
    await vi.advanceTimersByTimeAsync(5999);
    expect(serverWake.get().status).toBe("waking");
    await vi.advanceTimersByTimeAsync(1);
    expect(serverWake.get().status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
    stop();
  });

  it("only becomes unavailable at the overall deadline, then releases the queued plan to report its own error", async () => {
    pendingFetch();
    const { serverWake, WAKE_TIMEOUT_MS } = await import("./serverWake");
    const stop = serverWake.start();
    const proceed = vi.fn();
    const waiting = serverWake.wait(new AbortController().signal).then(proceed);
    await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS - 1);
    expect(serverWake.get().status).toBe("waking");
    expect(proceed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(serverWake.get().status).toBe("unavailable");
    await waiting;
    expect(proceed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("treats a plan submitted after a failed wake as Try again", async () => {
    const request = pendingFetch();
    const { serverWake, WAKE_TIMEOUT_MS } = await import("./serverWake");
    const stop = serverWake.start();
    await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS);
    expect(serverWake.get().status).toBe("unavailable");
    const startedAt = serverWake.get().startedAt;
    const proceed = vi.fn();
    const waiting = serverWake.wait(new AbortController().signal).then(proceed);
    await vi.advanceTimersByTimeAsync(0);
    expect(serverWake.get().status).toBe("waking");
    expect(serverWake.get().startedAt).not.toBe(startedAt);
    expect(proceed).not.toHaveBeenCalled();
    request.respond();
    await vi.advanceTimersByTimeAsync(3000);
    await waiting;
    expect(serverWake.get().status).toBe("ready");
    expect(proceed).toHaveBeenCalledOnce();
    stop();
  });

  it("avoids waking a server in explicit demo mode", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    const request = pendingFetch();
    const { serverWake } = await import("./serverWake");
    const stop = serverWake.start();
    await serverWake.wait(new AbortController().signal);
    expect(serverWake.get()).toMatchObject({ status: "ready", slow: false });
    expect(request.fetcher).not.toHaveBeenCalled();
    stop();
  });
});
