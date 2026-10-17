import {
  IconArrowRight, IconArrowsUpDown, IconBan, IconBed, IconBolt, IconCalendarTime,
  IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconCircleCheck,
  IconCircleCheckFilled, IconCircleDot, IconClock, IconClockPause, IconCloudRain,
  IconCloudSnow, IconCoffee, IconColumns, IconHelp, IconInfoCircle,
  IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconList, IconMapPin,
  IconMinus, IconPencil, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus,
  IconRefresh, IconRoute, IconRuler2, IconSettings, IconStack2, IconTruck,
  IconTypography, IconWeight, IconWifiOff, IconWind, IconWindsock, IconWorld,
  IconX, IconZoomScan, IconAlertTriangle, IconAlertCircle,
} from "@tabler/icons-react";

const icons = {
  arrow: IconArrowRight, swap: IconArrowsUpDown, close: IconX, settings: IconSettings,
  pin: IconMapPin, origin: IconCircleDot, departure: IconCalendarTime, clock: IconClock,
  truck: IconTruck, weight: IconWeight, ruler: IconRuler2, layers: IconStack2,
  compare: IconColumns, list: IconList, wind: IconWind, gust: IconWindsock,
  rain: IconCloudRain, snow: IconCloudSnow, check: IconCircleCheck,
  "check-filled": IconCircleCheckFilled, edit: IconPencil, fit: IconZoomScan,
  refresh: IconRefresh, globe: IconWorld, play: IconPlayerPlayFilled,
  pause: IconPlayerPauseFilled, info: IconInfoCircle, warning: IconAlertTriangle,
  alert: IconAlertCircle, offline: IconWifiOff, ban: IconBan, help: IconHelp,
  chevron: IconChevronRight, "chevron-left": IconChevronLeft,
  "chevron-right": IconChevronRight, "chevron-down": IconChevronDown,
  "chevron-up": IconChevronUp, collapse: IconLayoutSidebarLeftCollapse,
  expand: IconLayoutSidebarLeftExpand, coffee: IconCoffee, bed: IconBed,
  rest: IconClockPause, bolt: IconBolt, route: IconRoute, plus: IconPlus,
  minus: IconMinus, typography: IconTypography,
} as const;

/** One tree-shaken icon family; legacy names keep component call sites small. */
export function Icon({ name, size = 20 }: { name: keyof typeof icons; size?: number }) {
  const Component = icons[name];
  const normalized = size <= 17 ? 16 : size > 20 ? 24 : 20;
  return <Component size={normalized} stroke={normalized === 16 ? 2 : 1.75} aria-hidden="true" />;
}
