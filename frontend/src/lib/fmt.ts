/** US road and forecast units, shared by every numeric readout. */
export function number(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
export function unit(value: number, name: string, digits = 0) {
  const units: Record<string, string> = { mi: "mile", mph: "mile-per-hour", lb: "pound", h: "hour", m: "minute" };
  if (units[name] || ["mile", "mile-per-hour", "pound", "hour", "minute"].includes(name)) {
    return new Intl.NumberFormat("en-US", { style: "unit", unit: units[name] ?? name, unitDisplay: "short", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  return `${number(value, digits)} ${name}`;
}
export function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${number(minutes)}m`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `${number(hours)}h${remainder ? ` ${String(number(remainder)).padStart(2, "0")}m` : ""}`;
}
export const percent = (value: number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(value);
