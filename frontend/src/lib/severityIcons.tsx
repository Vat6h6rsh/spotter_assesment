import {
  IconCircleFilled, IconSquareFilled, IconTriangleFilled,
  IconSquareRotatedFilled, IconCircleXFilled, IconHelp,
} from "@tabler/icons-react";
import type { Level } from "../api/types";

const SEVERITY_ICONS = [
  IconCircleFilled, IconSquareFilled, IconTriangleFilled,
  IconSquareRotatedFilled, IconCircleXFilled, IconHelp,
] as const;

export function SeverityIcon({ level, size = 16 }: { level: Level; size?: number }) {
  const Shape = SEVERITY_ICONS[level === null ? 5 : level];
  return <Shape size={size} stroke={size === 16 ? 2 : 1.75} aria-hidden="true" />;
}
