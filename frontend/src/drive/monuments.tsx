import { Marker } from 'maplibre-gl';
import type { Map } from 'maplibre-gl';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconBed, IconCoffee } from '@tabler/icons-react';
import { WeatherIcon } from '../components/WeatherIcon';
import { weatherIconFor } from '../lib/weatherIcons';
import { SeverityIcon } from '../lib/severityIcons';
import { buildCheckpointPopup } from '../map/popupContent';
import { duration, localTime, shiftedDepartureRequest } from '../lib/time';
import { number } from '../lib/fmt';
import { checkpointPlaceLabel } from '../lib/checkpointPlace';
import { planner } from '../state/planner';
import { drive } from './state';
import type { DriveSession } from './state';
import type { CardTrigger } from './math';

export function monuments(map: Map, session: DriveSession, announce: (text: string) => void) {
  const cards: { marker: Marker; host: HTMLElement; body: HTMLElement; born: number; lifetime: number; collapsed: boolean }[] = [];
  let pulse: HTMLElement | null = null, pulseAt = 0;
  const focused = (card: typeof cards[number]) => card.host.contains(document.activeElement);
  const collapse = (card: typeof cards[number]) => {
    card.host.dataset.collapsed = 'true'; card.collapsed = true; card.body.inert = true;
    card.host.parentElement?.setAttribute('aria-hidden', 'true');
  };
  return {
    show(trigger: CardTrigger, now: number) {
      const { plan, route } = session, cp = trigger.checkpoint, rest = trigger.restIndex === undefined ? null : route.rests[trigger.restIndex];
      const content = cp ? buildCheckpointPopup(plan, route, cp) : null;
      const place = content?.title ?? checkpointPlaceLabel(route.checkpoints.reduce((best, point) => Math.abs(point.mi - (rest?.at_mi ?? 0)) < Math.abs(best.mi - (rest?.at_mi ?? 0)) ? point : best));
      const title = cp?.level === 4 ? 'Travel not recommended' : content?.severity ?? 'Rest';
      const driver = content ? ((cp!.level ?? 0) < 1 && content.slowdown ? content.slowdown : content.driver.split(' · ')[0]) + (cp!.load_adjusted ? ` · ${number(plan.inputs.cargo_lb)} lb` : '') : `Resting · ${duration(rest?.duration_s ?? 0)}`;
      const eta = content?.eta ?? localTime(rest!.start_utc, route.checkpoints.find(point => point.mi >= rest!.at_mi)?.tz ?? route.arrival_tz);
      const advice = cp?.level === 4 ? plan.recommendation.departure_advice : null;
      const root = document.createElement('div'); root.className = 'drive-monument-marker'; root.setAttribute('aria-hidden', 'true');
      const host = document.createElement('div'); host.className = 'drive-monument'; host.style.setProperty('--monument-color', `var(--${content?.token ?? 'primary'})`);
      host.style.setProperty('--monument-ink', content ? 'var(--on-severity)' : 'var(--on-primary)');
      const icon = cp ? <SeverityIcon level={cp.level} size={16} /> : rest?.kind === 'break30' ? <IconCoffee size={16} /> : <IconBed size={16} />;
      // Trusted local icons only; all provider/user strings enter via textContent.
      const badge = document.createElement('span'); badge.className = 'drive-monument-badge'; badge.dataset.level = String(cp?.level ?? 'rest'); badge.innerHTML = renderToStaticMarkup(cp ? <WeatherIcon icon={weatherIconFor(cp)} size={56} /> : icon);
      badge.append(document.createTextNode(title));
      const body = document.createElement('div'); body.className = 'drive-monument-body';
      const name = document.createElement('strong'); name.className = 'drive-monument-place'; name.textContent = place;
      const value = document.createElement('span'); value.className = 'drive-monument-driver num'; value.textContent = driver;
      const time = document.createElement('span'); time.className = 'fine-print num'; time.textContent = `ETA ${eta}`;
      body.append(badge, value, name, time);
      const guidance: string[] = [];
      const addLine = (text: string) => { const line = document.createElement('span'); line.className = 'drive-monument-advice fine-print num'; line.textContent = text; body.append(line); guidance.push(text); };
      if (cp?.level === 4 && content?.clearing) addLine(content.clearing);
      if (cp?.level === 3) {
        addLine('Drive with extreme caution');
        if (cp.clears_in_h != null && Number.isFinite(cp.clears_in_h) && cp.clears_in_h >= 0)
          addLine(`Eases in about ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(cp.clears_in_h)} h`);
      }
      if (advice) {
        addLine(`Or: ${advice.summary}`);
        root.removeAttribute('aria-hidden'); root.setAttribute('role', 'group'); root.setAttribute('aria-label', `${title} at ${place}`);
        body.classList.add('drive-monument-actionable');
        // Keep map gestures/click selection from consuming this ordinary keyboard-accessible action.
        for (const event of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick']) body.addEventListener(event, e => e.stopPropagation());
        const action = document.createElement('button'); action.type = 'button'; action.className = 'button secondary drive-monument-action num';
        action.textContent = `Plan +${number(advice.offset_h)} h`;
        action.addEventListener('click', () => { action.disabled = true; drive.end(); void planner.submit(shiftedDepartureRequest(plan, advice.offset_h)); });
        body.append(action);
      }
      if (content?.slowdown) { const slowdown = document.createElement('span'); slowdown.className = 'fine-print'; slowdown.textContent = content.slowdown; body.append(slowdown); }
      const pin = document.createElement('span'); pin.className = 'drive-monument-pin'; pin.setAttribute('aria-hidden', 'true'); pin.innerHTML = renderToStaticMarkup(icon);
      host.append(body, pin); root.append(host);
      while (cards.filter(card => !card.collapsed).length >= 3) collapse(cards.find(card => !card.collapsed && !focused(card))!);
      const marker = new Marker({ element: root, anchor: 'bottom', offset: [0, -28], pitchAlignment: 'viewport', rotationAlignment: 'viewport', subpixelPositioning: true }).setLngLat(trigger.position).addTo(map);
      cards.push({ marker, host, body, born: now, lifetime: cp?.level === 4 ? 8000 : 2500, collapsed: false });
      if (cp?.level === 4 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        pulse?.remove(); pulse = document.createElement('div'); pulse.className = 'drive-edge-pulse'; pulse.setAttribute('aria-hidden', 'true');
        const container = map.getContainer(); (container.closest('.map-region') ?? container).append(pulse); pulseAt = now;
      }
      announce(`${place}. ${title}. ${driver}. ETA ${eta}.${guidance.length ? ` ${guidance.join(' ')}` : ''}`);
    },
    tick(now: number) { if (pulse && now - pulseAt >= 700) { pulse.remove(); pulse = null; } cards.forEach(card => { if (!card.collapsed && now - card.born >= card.lifetime && !focused(card) && !card.host.matches(':hover')) collapse(card); }); return Boolean(pulse) || cards.some(card => !card.collapsed); },
    clear() { cards.forEach(card => card.marker.remove()); cards.length = 0; pulse?.remove(); pulse = null; },
  };
}
