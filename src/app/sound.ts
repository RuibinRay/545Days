/**
 * Sound cues (M8): a handful of short synthesized tones from the Web Audio API — no asset files,
 * nothing licensed, nothing that plays before the player has touched the page. Off by default;
 * the World tab turns it on. Every cue also exists as text in the ticker, so nothing depends on it.
 */
export type Cue = "mission" | "achievement" | "ending" | "caravan" | "warning";

const KEY = "545.sound";
let ctx: AudioContext | null = null;
let enabled = false;
try { enabled = localStorage.getItem(KEY) === "on"; } catch { enabled = false; }

export function soundEnabled(): boolean { return enabled; }

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
  if (on) { ensure(); void ctx?.resume(); cue("mission"); }
}

/** The context is created on the first user gesture (browsers block audio before one). */
function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try { ctx = new AudioContext(); } catch { ctx = null; }
  return ctx;
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, gain = 0.08, type: OscillatorType = "triangle"): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
  o.connect(g).connect(ac.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** Plays a cue if sound is on. Safe to call from anywhere; silently does nothing without audio. */
export function cue(kind: Cue): void {
  if (!enabled) return;
  const ac = ensure();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  const t = ac.currentTime + 0.01;
  switch (kind) {
    case "mission": tone(ac, t, 523, 0.18); tone(ac, t + 0.16, 784, 0.28); break;                       // a two-note call
    case "achievement": tone(ac, t, 659, 0.12); tone(ac, t + 0.1, 784, 0.12); tone(ac, t + 0.2, 1047, 0.3); break; // rising arpeggio
    case "ending": tone(ac, t, 196, 1.2, 0.07, "sine"); tone(ac, t, 247, 1.2, 0.05, "sine"); tone(ac, t + 0.3, 294, 1.0, 0.05, "sine"); break; // a low chord
    case "caravan": tone(ac, t, 440, 0.08, 0.04, "square"); tone(ac, t + 0.09, 440, 0.08, 0.04, "square"); break; // a cart bell
    case "warning": tone(ac, t, 330, 0.25, 0.07, "sawtooth"); tone(ac, t + 0.22, 262, 0.35, 0.07, "sawtooth"); break; // a falling pair
  }
}
