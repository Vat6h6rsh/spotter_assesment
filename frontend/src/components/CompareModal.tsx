import type { Level, Plan, Route } from "../api/types";
import { duration, number, percent, unit } from "../lib/fmt";
import { Modal } from "./Modal";
import { SeverityIcon } from "./Severity";
export function CompareModal({
  plan,
  onClose,
}: {
  plan: Plan;
  onClose: () => void;
}) {
  const rows: { label: string; level?: Level; value: (route: Route) => string }[] = [
    {
      label: "No Travel miles",
      level: 4,
      value: (r) => unit(r.risk.miles_by_level.no_travel, "mile"),
    },
    {
      label: "Severe miles",
      level: 3,
      value: (r) => unit(r.risk.miles_by_level.severe, "mile"),
    },
    {
      label: "High miles",
      level: 2,
      value: (r) => unit(r.risk.miles_by_level.high, "mile"),
    },
    {
      label: "Average risk (0–4)",
      value: (r) => r.risk.avg_risk === null ? "Unknown" : number(r.risk.avg_risk, 2),
    },
    { label: "Elapsed time", value: (r) => duration(r.total_s) },
  ];
  return (
    <Modal title="Compare your routes" onClose={onClose}>
      <p className="muted">Risk first. Travel time breaks the tie.</p>
      <div className="comparison-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th scope="col">In priority order</th>
              {plan.routes.map((r) => (
                <th key={r.id} scope="col">
                  <span className="route-letter">{r.id}</span>
                  <span>{r.label}</span>
                  {r.id === plan.recommendation.route_id && (
                    <span className="recommended-label">Recommended</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.level !== undefined && <SeverityIcon level={row.level} size={16} />}
                  {row.label}
                </th>
                {plan.routes.map((r) => (
                  <td
                    key={r.id}
                    className={`num ${
                      r.id === plan.recommendation.route_id
                        ? "selected-column"
                        : ""
                    }`}
                  >
                    {row.value(r)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Weather coverage</th>
              {plan.routes.map((r) => (
                <td key={r.id} className="num">{percent(r.risk.coverage)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="fine-print">
        No Travel excludes a route. Severe and High comparisons allow{" "}
        <span className="num">{unit(plan.inputs.spacing_mi / 2, "mile", 1)}</span> tolerance; average risk allows <span className="num">0.05</span>.
        Missing weather can change the result.
      </p>
    </Modal>
  );
}
