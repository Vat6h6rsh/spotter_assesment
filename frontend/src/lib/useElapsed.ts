import { useEffect, useState } from "react";
/** Wall-clock counters update once a second; no animation frames enter React state. */
export function useElapsed(startedAt: number | null, running = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, running]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}
