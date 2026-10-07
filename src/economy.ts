// Passive income. Income is computed from wall-clock time, so it keeps flowing while the
// app is backgrounded or closed (up to OFFLINE_CAP_HOURS).

import { BUILDING_BY_ID, OFFLINE_CAP_HOURS } from './config';
import { save, state } from './state';

/** Gaps longer than this count as "you were away" and get a welcome-back popup. */
const AWAY_THRESHOLD_S = 60;
const AUTOSAVE_MS = 5000;

let lastTick = state.lastSaved;
let lastSave = Date.now();
let pendingOffline = 0;

export function incomePerSecond(): number {
  return state.buildings.reduce((sum, b) => sum + BUILDING_BY_ID[b.type].income(b.level), 0);
}

/** Call every frame from the active scene. */
export function tickEconomy(): void {
  const now = Date.now();
  const gapS = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;

  const earned = incomePerSecond() * Math.min(gapS, OFFLINE_CAP_HOURS * 3600);
  state.coins += earned;
  if (gapS > AWAY_THRESHOLD_S && earned >= 1) pendingOffline += earned;

  if (now - lastSave > AUTOSAVE_MS) {
    save();
    lastSave = now;
  }
}

/** Coins earned while away since the last call, or 0. */
export function takeOfflineEarnings(): number {
  const amount = Math.floor(pendingOffline);
  pendingOffline = 0;
  return amount;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
