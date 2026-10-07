// Passive income and town growth. Both run on wall-clock time, so they keep going while the
// app is backgrounded or closed (up to the offline cap, which Warehouses raise).

import { moveInMultiplier, totalIncome, townHappiness } from './happiness';
import { tickPopulation } from './population';
import { offlineCapHours } from './services';
import { save, state, type Resident } from './state';

/** Gaps longer than this count as "you were away" and get a welcome-back popup. */
const AWAY_THRESHOLD_S = 60;
const AUTOSAVE_MS = 5000;

let lastTick = state.lastSaved;
let lastSave = Date.now();
let pendingOffline = { coins: 0, residents: 0 };
let arrivals: Resident[] = [];

/** Town income in coins per minute (the unit all income is designed and shown in). */
export function incomePerMinute(): number {
  return totalIncome();
}

/** Call every frame from the active scene. */
export function tickEconomy(): void {
  const now = Date.now();
  const gapS = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;
  const effective = Math.min(gapS, offlineCapHours() * 3600);

  // Pay out with the current workforce first, then let new residents arrive.
  const earned = (incomePerMinute() / 60) * effective;
  state.coins += earned;
  // Happier towns attract newcomers faster.
  const arrived = tickPopulation(effective * moveInMultiplier(townHappiness() ?? 50));

  if (gapS > AWAY_THRESHOLD_S) {
    pendingOffline.coins += earned;
    pendingOffline.residents += arrived.length;
  } else {
    arrivals.push(...arrived);
  }

  if (now - lastSave > AUTOSAVE_MS) {
    save();
    lastSave = now;
  }
}

/** Playtesting: pretend the game was closed for `seconds`. The next tick catches up as if offline. */
export function skipTime(seconds: number): void {
  lastTick -= seconds * 1000;
}

/** What happened while away since the last call, or null if nothing worth reporting. */
export function takeOfflineReport(): { coins: number; residents: number } | null {
  const report = { coins: Math.floor(pendingOffline.coins), residents: pendingOffline.residents };
  pendingOffline = { coins: 0, residents: 0 };
  return report.coins > 0 || report.residents > 0 ? report : null;
}

/** Residents who moved in during play since the last call (for little arrival popups). */
export function takeArrivals(): Resident[] {
  const out = arrivals;
  arrivals = [];
  return out;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
