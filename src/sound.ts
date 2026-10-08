// Sound effects and music, synthesised with the Web Audio API (no audio files to ship).
// Browsers (iOS especially) only allow audio after a tap, so everything waits for unlockAudio().

import { isNight } from './world';
import { state } from './state';

let ctx: AudioContext | undefined;
let sfxBus: GainNode;
let musicBus: GainNode;
let musicTimer: number | undefined;

/** Creates (or wakes up) the audio context. Call from a user gesture. */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.35;
    musicBus.connect(ctx.destination);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx?.suspend();
      else void ctx?.resume();
    });
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (state.settings.music) startMusic();
}

interface ToneOptions {
  type?: OscillatorType;
  volume?: number;
  /** Glide to this frequency over the note. */
  slideTo?: number;
  delay?: number;
  attack?: number;
  bus?: GainNode;
}

function tone(freq: number, duration: number, o: ToneOptions = {}): void {
  if (!ctx) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + duration);
  const attack = o.attack ?? 0.01;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.volume ?? 0.3, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(o.bus ?? sfxBus);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** A burst of filtered noise: splashes, whooshes, rain. */
function noise(duration: number, volume: number, filterFreq: number, delay = 0): void {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(gain).connect(sfxBus);
  src.start(t);
}

const can = () => !!ctx && state.settings.sound;

export const sfx = {
  tap: () => can() && tone(660, 0.06, { type: 'triangle', volume: 0.12 }),
  cast: () => {
    if (!can()) return;
    noise(0.25, 0.15, 2500);
    noise(0.35, 0.25, 900, 0.22);
  },
  /** Pricier fish make a brighter blip. */
  catch: (value: number) => {
    if (!can()) return;
    const base = 440 + Math.min(600, Math.log2(1 + value) * 70);
    tone(base, 0.12, { type: 'square', volume: 0.08 });
    tone(base * 1.5, 0.15, { type: 'square', volume: 0.07, delay: 0.07 });
  },
  bump: () => can() && tone(140, 0.2, { type: 'sine', volume: 0.4, slideTo: 60 }),
  sting: () => can() && tone(900, 0.25, { type: 'sawtooth', volume: 0.08, slideTo: 300 }),
  coins: () => {
    if (!can()) return;
    tone(988, 0.12, { type: 'triangle', volume: 0.15 });
    tone(1319, 0.25, { type: 'triangle', volume: 0.15, delay: 0.08 });
  },
  place: () => can() && tone(220, 0.12, { type: 'triangle', volume: 0.25, slideTo: 160 }),
  fanfare: () => {
    if (!can()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', volume: 0.15, delay: i * 0.1 }));
  },
  horn: () => {
    if (!can()) return;
    tone(110, 1.1, { type: 'sawtooth', volume: 0.08, attack: 0.15 });
    tone(165, 1.1, { type: 'sawtooth', volume: 0.05, attack: 0.15 });
  },
  chime: () => can() && tone(1175, 0.3, { type: 'sine', volume: 0.1 }),
};

// ------------------------------------------------------------------ Music
// A slow, gentle pentatonic noodle over a four-chord loop. Sparser and lower at night.

const ROOTS = [196, 165, 175, 147]; // G, E, F, D (Hz)
const PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
let beat = 0;

function musicStep(): void {
  if (!ctx || !state.settings.music || ctx.state !== 'running') return;
  const night = isNight();
  const root = ROOTS[Math.floor(beat / 8) % ROOTS.length] * (night ? 0.75 : 1);
  if (beat % 8 === 0) tone(root / 2, 3.2, { type: 'sine', volume: 0.12, attack: 0.4, bus: musicBus });
  if (Math.random() < (night ? 0.35 : 0.55)) {
    const step = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
    tone(root * 2 * step, 1.4, { type: 'triangle', volume: 0.06, attack: 0.03, bus: musicBus });
  }
  beat++;
}

export function startMusic(): void {
  if (musicTimer !== undefined || !ctx) return;
  musicTimer = window.setInterval(musicStep, 420);
}

export function stopMusic(): void {
  if (musicTimer !== undefined) window.clearInterval(musicTimer);
  musicTimer = undefined;
}

export function setMusic(on: boolean): void {
  state.settings.music = on;
  if (on) startMusic();
  else stopMusic();
}

export function setSound(on: boolean): void {
  state.settings.sound = on;
}
