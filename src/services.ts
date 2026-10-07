// Service buildings: staffed, but they help the town instead of earning coins.

import { OFFLINE_CAP_HOURS } from './config';
import { defOf, workerCounts } from './population';
import { state, type PlacedBuilding } from './state';

/** Sum of `perWorker(level) × workers` over every building that has the effect. */
function total(perWorker: (b: PlacedBuilding) => number | undefined, counts = workerCounts()): number {
  let sum = 0;
  for (const b of state.buildings) {
    const each = perWorker(b);
    if (each) sum += each * (counts.get(b.id) ?? 0);
  }
  return sum;
}

/** Hours of income that keep accruing while the game is closed. */
export function offlineCapHours(): number {
  return OFFLINE_CAP_HOURS + total((b) => defOf(b).offlineHoursPerWorker?.(b.level));
}

/** Extra fish the hook can carry, from Net Maker workers. */
export function hookBonus(): number {
  return total((b) => defOf(b).hookPerWorker);
}

/** Sonar range in metres below/around the hook, from Lighthouse keepers (0 = no sonar). */
export function sonarRange(): number {
  return total((b) => defOf(b).sonarPerWorker?.(b.level));
}

/** Happiness one tavern gives a home `gap` tiles away (0 if out of range or unstaffed). */
export function tavernMood(tavern: PlacedBuilding, gap: number, counts = workerCounts()): number {
  const effect = defOf(tavern).moodPerWorker;
  if (!effect || gap > effect.radius) return 0;
  return effect.amount(tavern.level) * (counts.get(tavern.id) ?? 0);
}
