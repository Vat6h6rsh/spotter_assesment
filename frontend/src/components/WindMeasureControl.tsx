import type { WindMeasure } from "../api/types";

const choices = [
  { value: "gust", label: "Gusts" },
  { value: "sustained", label: "Sustained" },
] as const;

export function WindMeasureControl({ value, onChange, prefix }: {
  value: WindMeasure;
  onChange: (value: WindMeasure) => void;
  prefix: string;
}) {
  return <div className="wind-field">
    <span id={`${prefix}-wind-label`}>Wind used for risk</span>
    <div className="wind-segments" role="radiogroup" aria-labelledby={`${prefix}-wind-label`} aria-describedby={`${prefix}-wind-help ${prefix}-wind-choice`}>
      {choices.map((choice, index) => <button
        key={choice.value}
        type="button"
        role="radio"
        aria-checked={value === choice.value}
        tabIndex={value === choice.value ? 0 : -1}
        onClick={() => onChange(choice.value)}
        onKeyDown={(event) => {
          const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
          if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + delta! + choices.length) % choices.length;
          onChange(choices[next].value);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
        }}
      >{choice.label}</button>)}
    </div>
    <p className="field-hint" id={`${prefix}-wind-help`}>Gusts are short peaks; sustained is the average over about 10 minutes. Thresholds: 25 / 35 / 45 / 55 mph.</p>
    <p className="field-hint" id={`${prefix}-wind-choice`}>{value === "gust" ? "Rates the higher of gust or sustained speed (mph)." : "Rates the steady speed only (mph)."}</p>
  </div>;
}
