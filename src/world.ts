// Time of day, weather and the fish of the day. All of it follows the wall clock, so it's the
// same in every scene and keeps going while the game is closed.

import { AREA_BY_ID, FISH, WORLD, type FishType } from './config';
import { fishingStats } from './state';
import { ownsArea } from './town';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';

/** Small, stable hash → 0..1, so the same time slot always gets the same weather. */
function hash01(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 0..1 through the day: 0 is dawn, ~0.5 is evening, the last part is night. */
export function dayPhase(now = Date.now()): number {
  return (now % (WORLD.dayMinutes * 60_000)) / (WORLD.dayMinutes * 60_000);
}

/** How dark it is, 0 (day) .. 1 (deep night), with soft dusk and dawn. */
export function darkness(now = Date.now()): number {
  const p = dayPhase(now);
  const { duskStart, nightStart, dawnStart } = WORLD;
  if (p < duskStart) return 0;
  if (p < nightStart) return (p - duskStart) / (nightStart - duskStart);
  if (p < dawnStart) return 1;
  return 1 - (p - dawnStart) / (1 - dawnStart);
}

export const isNight = (now = Date.now()): boolean => darkness(now) > 0.5;

/** Minutes until the light changes (night falls, or day breaks). */
export function minutesToDayChange(now = Date.now()): number {
  const p = dayPhase(now);
  const next = p < WORLD.nightStart ? WORLD.nightStart : 1;
  return Math.ceil((next - p) * WORLD.dayMinutes);
}

const slotOf = (now: number) => Math.floor(now / (WORLD.weatherMinutes * 60_000));

export function weather(now = Date.now()): Weather {
  const r = hash01(slotOf(now));
  let acc = 0;
  for (const [kind, chance] of Object.entries(WORLD.weatherChances) as [Weather, number][]) {
    acc += chance;
    if (r < acc) return kind;
  }
  return 'clear';
}

/** Minutes until the weather may change. */
export function minutesToWeatherChange(now = Date.now()): number {
  const slotMs = WORLD.weatherMinutes * 60_000;
  return Math.ceil((slotMs - (now % slotMs)) / 60_000);
}

export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm' };

/** Today's date as "2026-10-08", in the player's own time zone. */
export function dayKey(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayNumber = (key = dayKey()) => key.split('-').reduce((n, part) => n * 100 + Number(part), 0);

/** One regular fish from an area you can reach sells for extra all day. */
export function fishOfTheDay(): FishType {
  const pool = FISH.filter((f) => !f.legendary && ownsArea(AREA_BY_ID[f.area]) && f.minDepth <= fishingReach(f));
  const list = pool.length > 0 ? pool : FISH.filter((f) => f.area === 'harbor' && !f.legendary);
  return list[Math.floor(hash01(dayNumber()) * list.length)];
}

/** The deepest the line reaches in a fish's area. */
function fishingReach(f: FishType): number {
  return fishingStats().lineLength + AREA_BY_ID[f.area].lineBonus;
}
