import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../api/types";
const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../api/client", () => ({ geocode: search }));
import { PlaceInput } from "./PlaceInput";
afterEach(() => {
  vi.useRealTimers();
  search.mockReset();
});
describe("place search", () => {
  it("keeps edited text, debounces 300 ms, cancels old queries, and accepts a keyboard selection", async () => {
    vi.useFakeTimers();
    search.mockResolvedValue({
      data: {
        results: [
          {
            id: "denver",
            label: "Denver, CO, USA",
            lat: 39.739,
            lon: -104.99,
            tz: "America/Denver",
          },
        ],
      },
      demo: false,
    });
    function Harness() {
      const [value, setValue] = useState<Place | null>({
        label: "Joliet, IL, USA",
        lat: 41.525,
        lon: -88.081,
      });
      return <PlaceInput label="From" value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "From" });
    fireEvent.change(input, { target: { value: "Den" } });
    expect(input).toHaveValue("Den");
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(search).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(search).toHaveBeenCalledTimes(1);
    const previousSignal = search.mock.calls[0][1] as AbortSignal;
    fireEvent.change(input, { target: { value: "Denv" } });
    expect(previousSignal.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Denver, CO, USA");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
