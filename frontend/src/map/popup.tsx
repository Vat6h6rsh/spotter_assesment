import { SeverityIcon } from "../lib/severityIcons";
import type { buildCheckpointPopup } from "./popupContent";
import { WeatherIcon } from "../components/WeatherIcon";

export function CheckpointPopup({ content }: { content: ReturnType<typeof buildCheckpointPopup> }) {
  return <div className="checkpoint-popup">
    <strong className="num">{content.title}</strong>
    <span className="num">{content.subtitle}</span>
    <span className="num">ETA {content.eta}</span>
    <span className={`popup-level risk-${content.token}`}><WeatherIcon icon={content.weatherIcon} staticOnly size={32} /><SeverityIcon level={content.level} size={16} />{content.severity}</span>
    <span>{content.driver}</span>
    {content.clearing && <span className="checkpoint-clearing num">{content.clearing}</span>}
    {content.slowdown && <span className="slowdown-note">{content.slowdown} (FHWA estimate)</span>}
  </div>;
}
