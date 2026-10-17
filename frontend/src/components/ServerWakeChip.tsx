import { useServerWake } from "../state/serverWake";

export function ServerWakeChip() {
  const wake = useServerWake();
  if (wake.status !== "waking" || !wake.slow) return null;
  return (
    <div className="server-wake-chip" role="status" aria-live="polite">
      Waking the server… (free hosting, up to a minute)
    </div>
  );
}
