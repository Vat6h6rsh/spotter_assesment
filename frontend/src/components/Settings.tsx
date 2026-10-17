import { IconArrowLeft, IconArrowRight, IconCheck } from "@tabler/icons-react";
import {
  usePreferences,
  preferences,
  themes,
  resolveTheme,
} from "../state/preferences";
import { FONTS, FONT_SAMPLE, fonts, useFont, type FontId } from "../state/fonts";
import { PlanningOptions } from "./PlanningOptions";
import { Severity } from "./Severity";
import { TruckCredit } from "../drive/credits";

export function Settings({ onBack }: { onBack: () => void }) {
  const value = usePreferences();
  const font = useFont();
  return (
    <main className="settings-page">
      <div className="settings-content">
        <button className="text-button" onClick={onBack}>
          <IconArrowLeft size={20} stroke={1.75} aria-hidden="true" />
          Back to your route
        </button>
        <h1>Settings</h1>
        <p className="settings-intro">Your choices stay on this device.</p>
        <section className="settings-section">
          <div className="settings-section-heading">
            <h2>Appearance</h2>
            <span>Changes preview instantly</span>
          </div>
          <div className="theme-grid" role="group" aria-label="Theme">
            <button
              className={`theme-card system-theme ${value.theme === "system" ? "theme-active" : ""}`}
              aria-pressed={value.theme === "system"}
              aria-label="System theme"
              onClick={() => preferences.update({ theme: "system" })}
            >
              <div className="theme-preview system-preview">
                <span />
                <span />
                <i />
              </div>
              <div className="theme-name">
                <strong>System</strong>
                <span>
                  {value.theme === "system" && <IconCheck size={16} aria-hidden="true" />}
                  Follows your device
                </span>
              </div>
            </button>
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-card ${value.theme === theme.id ? "theme-active" : ""}`}
                aria-pressed={value.theme === theme.id}
                aria-label={`Theme ${theme.id}: ${theme.name}, ${theme.mode}`}
                onClick={() => preferences.update({ theme: theme.id })}
              >
                <div className="theme-preview" style={{ background: theme.colors[0] }}>
                  <span style={{ background: theme.colors[2] }} />
                  <span style={{ background: theme.colors[1] }} />
                  <i style={{ background: theme.colors[3] }} />
                  <div className="swatches">
                    {theme.colors.map((color, index) => <b key={index} style={{ background: color }} />)}
                  </div>
                </div>
                <div className="theme-name">
                  <strong>{theme.id} · {theme.name}</strong>
                  <span>
                    {value.theme === theme.id && <IconCheck size={16} aria-hidden="true" />}
                    {value.theme === theme.id ? "Selected" : theme.mode}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <p className="fine-print">
            System uses Glacier & ink in light mode and Midnight teal in dark mode.
          </p>
          <div className="theme-live-preview">
            <span className="muted">
              Theme preview · {resolveTheme(value.theme, matchMedia("(prefers-color-scheme: dark)").matches)}
            </span>
            <strong><span className="route-letter">B</span> Your next route</strong>
            <p>
              <Severity level={0} />
              <Severity level={2} />
              <Severity level={3} />
              <Severity level={4} />
              <Severity level={null} />
            </p>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-heading">
            <h2 id="typeface-heading">Typeface</h2>
            <span>Preview before returning to your route</span>
          </div>
          <div className="font-grid" role="radiogroup" aria-labelledby="typeface-heading" aria-busy={font.pending !== null}>
            {(Object.keys(FONTS) as FontId[]).map((id) => (
              <label key={id} className={`font-card ${(font.pending ?? font.id) === id ? "font-active" : ""}`}>
                <input
                  type="radio"
                  name="typeface"
                  value={id}
                  checked={(font.pending ?? font.id) === id}
                  onChange={() => void fonts.select(id)}
                />
                <span>
                  <strong>{FONTS[id].label}</strong>
                  <span className="muted">{FONTS[id].description}</span>
                </span>
                {font.pending === id && <span className="fine-print">Loading…</span>}
              </label>
            ))}
          </div>
          <p className="font-live-sample num" aria-label="Typeface live sample">{FONT_SAMPLE}</p>
          <p className="fine-print" role="status" aria-live="polite">
            {font.error || (font.pending ? "Loading typeface…" : `${FONTS[font.id].label} selected.`)}
          </p>
        </section>
        <section className="settings-section">
          <h2>Planning defaults</h2>
          <p className="muted">Used when you start a new trip.</p>
          <PlanningOptions value={value} onChange={(patch) => preferences.update(patch)} prefix="settings" />
        </section>
        <section className="settings-section">
          <h2>Drive preview</h2>
          <label className="drive-preview-setting"><input type="checkbox" checked={value.drivePreview} onChange={event => preferences.update({ drivePreview: event.currentTarget.checked })} /> Play a drive preview of the selected route</label>
          <p className="muted">Switch off for classic forecast playback. Your device’s reduced motion setting gives a 2D preview with a steady camera.</p>
        </section>
        <section className="settings-section">
          <h2>About / credits</h2>
          <p className="fine-print"><TruckCredit /></p>
          <p className="fine-print">Music: Erik Satie, “Gnossienne No. 1” (1890; composition public domain). Recording supplied by the founder for this private demo. Primary drive-preview track. Alternative: “Mausam Aaj Tak” segment music (2016), Aaj Tak / TV Today Network, at the founder’s request for this private demo; not licensed for redistribution.</p>
          <p className="fine-print">Weather icons: <a href="https://github.com/basmilius/weather-icons" target="_blank" rel="noreferrer">Meteocons by Bas Milius</a> (MIT)</p>
        </section>
        <section className="settings-section walkthrough-section">
          <div>
            <h2>A quick look around</h2>
            <p className="muted">Available in final build</p>
          </div>
          <button className="button secondary" disabled aria-describedby="walkthrough-note">
            <IconArrowRight size={20} stroke={1.75} aria-hidden="true" />
            Launch app walkthrough
          </button>
          <span id="walkthrough-note" className="sr-only">Available in final build</span>
        </section>
        <p className="fine-print settings-footer">Weather Route · v0.5 · Plan while parked.</p>
      </div>
    </main>
  );
}
