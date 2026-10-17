import type { RestPlan, Spacing, WindMeasure } from "../api/types";
import { WindMeasureControl } from "./WindMeasureControl";
export interface Options {
  spacing: Spacing;
  wind: WindMeasure;
  rest: RestPlan;
  weatherSlowdown: boolean;
}
export function PlanningOptions({
  value,
  onChange,
  prefix,
}: {
  value: Options;
  onChange: (patch: Partial<Options>) => void;
  prefix: string;
}) {
  return (
    <div className="options-fields">
      <label htmlFor={`${prefix}-spacing`}>
        Checkpoint spacing
        <select
          id={`${prefix}-spacing`}
          value={value.spacing}
          onChange={(e) =>
            onChange({ spacing: Number(e.target.value) as Spacing })
          }
        >
          <option value={10}>Every 10 miles</option>
          <option value={25}>Every 25 miles</option>
          <option value={50}>Every 50 miles</option>
        </select>
      </label>
      <WindMeasureControl value={value.wind} onChange={(wind) => onChange({ wind })} prefix={prefix} />
      <label className="check-field" htmlFor={`${prefix}-slowdown`}>
        <input
          id={`${prefix}-slowdown`}
          type="checkbox"
          checked={value.weatherSlowdown}
          onChange={(e) => onChange({ weatherSlowdown: e.target.checked })}
        />
        <span>
          Slow arrival times for rain and snow
          <small>FHWA freeway estimates: light −8%, heavy rain −10%, heavy snow −22%</small>
        </span>
      </label>
      <label htmlFor={`${prefix}-rest`}>
        Rest plan
        <select
          id={`${prefix}-rest`}
          value={value.rest.mode}
          onChange={(e) =>
            onChange({
              rest:
                e.target.value === "custom"
                  ? { mode: "custom", drive_hours: 8, rest_hours: 10 }
                  : { mode: e.target.value as "auto" | "none" },
            })
          }
        >
          <option value="auto">Suggested driving breaks</option>
          <option value="custom">Custom driving / rest cycle</option>
          <option value="none">No planned rests</option>
        </select>
      </label>
      {value.rest.mode === "custom" && (
        <div className="field-pair">
          <label>
            Drive hours
            <input
              type="number"
              min={1}
              max={11}
              step="any"
              required
              value={value.rest.drive_hours}
              onChange={(e) => {
                if (value.rest.mode === "custom")
                  onChange({
                    rest: {
                      ...value.rest,
                      drive_hours: Number(e.target.value),
                    },
                  });
              }}
            />
          </label>
          <label>
            Rest hours
            <input
              type="number"
              min={0.5}
              max={34}
              step="any"
              required
              value={value.rest.rest_hours}
              onChange={(e) => {
                if (value.rest.mode === "custom")
                  onChange({
                    rest: { ...value.rest, rest_hours: Number(e.target.value) },
                  });
              }}
            />
          </label>
        </div>
      )}
      <p className="fine-print">
        {value.rest.mode === "auto"
          ? "30 min after 8 h driving; 10 h off after 11 h. The 14 h on-duty window is outside this model."
          : value.rest.mode === "none"
            ? "Travel times will include driving only. Plan your required breaks separately."
            : "Your cycle repeats until arrival. Rest locations are estimates."}
      </p>
    </div>
  );
}
