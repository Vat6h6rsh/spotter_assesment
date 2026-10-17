import { describe, expect, it, vi } from "vitest";
import { timeline } from "../state/timeline";
describe("shared forecast frame scheduler", () => {
  it("coalesces scrub input and drives settling with one RAF until listeners finish", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; }));
    const listener = vi.fn((_hour: number, now: number) => now < 48);
    const unsubscribe = timeline.onFrame(listener);
    timeline.set(1); timeline.set(2); timeline.set(3);
    expect(callbacks).toHaveLength(1);
    callbacks[0](16);
    expect(listener).toHaveBeenLastCalledWith(3, 16); expect(callbacks).toHaveLength(2);
    callbacks[1](32); expect(callbacks).toHaveLength(3);
    callbacks[2](48); expect(callbacks).toHaveLength(3);
    unsubscribe();
    timeline.set(4); callbacks[3](64);
    expect(listener).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});
