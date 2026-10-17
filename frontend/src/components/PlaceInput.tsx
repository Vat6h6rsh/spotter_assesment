import { useEffect, useId, useRef, useState } from "react";
import type { GeocodeResult, Place } from "../api/types";
import { geocode } from "../api/client";
import { Icon } from "./Icon";
export function PlaceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
}) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(""),
    [demo, setDemo] = useState(false);
  const id = useId(),
    wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (query.trim().length < 3 || value) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await geocode(query.trim(), controller.signal);
        setResults(response.data.results);
        setDemo(response.demo);
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Place search unavailable. Try again.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);
  const choose = (place: GeocodeResult) => {
    onChange(place);
    setQuery(place.label);
    setOpen(false);
    setResults([]);
    setLoading(false);
  };
  return (
    <div
      className="place-field"
      ref={wrapper}
      onBlur={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="input-icon">
        <Icon name={label === "From" ? "origin" : "pin"} size={16} />
        <input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded={open && results.length > 0}
          aria-activedescendant={
            active >= 0 && open ? `${id}-${active}` : undefined
          }
          value={value?.label ?? query}
          placeholder="City or address"
          required
          onFocus={() => {
            if (results.length) setOpen(true);
          }}
          onChange={(event) => {
            const text = event.target.value;
            if (value) onChange(null);
            setQuery(text);
            setResults([]);
            setActive(-1);
            setLoading(text.trim().length >= 3);
            setError("");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    results.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (
              event.key === "Enter" &&
              open &&
              active >= 0 &&
              results[active]
            ) {
              event.preventDefault();
              choose(results[active]);
            }
          }}
        />
      </div>
      {open && results.length > 0 && (
        <ul
          className="suggestions"
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} matches`}
        >
          {results.map((place, index) => (
            <li
              key={place.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(place)}
              >
                <Icon name="pin" size={16} />
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="field-status" role="status">
        {loading
          ? "Searching places…"
          : error ||
            (demo && open
              ? "Demo data · sample place matches"
              : open && query.length >= 3 && !value && !results.length
                ? "No matches. Try a nearby city."
                : "")}
      </span>
    </div>
  );
}
