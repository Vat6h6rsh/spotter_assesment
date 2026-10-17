import type { Level, MilesByLevel } from "../api/types";
import { riskDescription, severities, severity } from "../lib/risk";
import { SeverityIcon } from "../lib/severityIcons";
export { SeverityIcon } from "../lib/severityIcons";
export function Severity({
  level,
  compact = false,
}: {
  level: Level;
  compact?: boolean;
}) {
  const s = severity(level);
  return (
    <span className={`severity risk-${s.token}`}>
      <SeverityIcon level={level} />
      {!compact && s.label}
      {compact && <span className="sr-only">{s.label}</span>}
    </span>
  );
}
export function RiskBar({ miles }: { miles: MilesByLevel }) {
  return (
    <div className="risk-bar" role="img" aria-label={riskDescription(miles)}>
      {severities.map(
        (s) =>
          miles[s.key] > 0 && (
            <span
              key={s.key}
              className={`risk-fill-${s.token}`}
              style={{ flex: miles[s.key] }}
            />
          ),
      )}
    </div>
  );
}
