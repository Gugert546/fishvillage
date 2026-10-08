// Service buildings: staffed, but they help the town instead of earning coins.

import { OFFLINE_CAP_HOURS } from './config';
import { perkBonus } from './perks';
import { projectDone } from './projects';
import { defOf, tileGap, workerCounts } from './population';
import { state, type PlacedBuilding } from './state';
import { isWorking, wateredTiles } from './water';

/** Sum of `perWorker(level) × workers` over every working building that has the effect. */
function total(perWorker: (b: PlacedBuilding) => number | undefined, counts = workerCounts()): number {
  const wet = wateredTiles();
  let sum = 0;
  for (const b of state.buildings) {
    const each = perWorker(b);
    if (each && isWorking(b, wet)) sum += each * (counts.get(b.id) ?? 0);
  }
  return sum;
}

/** Extra sale price for your catch at the dock, from Fish Market workers (0.1 = +10%). */
export function marketBonus(): number {
  return total((b) => defOf(b).dockPricePerWorker?.(b.level));
}

/** Extra income for a workplace from staffed Water Mills within reach (0.2 = +20%). */
export function millBoost(b: PlacedBuilding, counts = workerCounts(), wet = wateredTiles()): number {
  let boost = 0;
  for (const mill of state.buildings) {
    const effect = defOf(mill).millPerWorker;
    if (!effect || mill === b || tileGap(mill, b) > effect.radius || !isWorking(mill, wet)) continue;
    boost += effect.amount * (counts.get(mill.id) ?? 0);
  }
  return boost;
}

/** Hours of income that keep accruing while the game is closed. */
export function offlineCapHours(): number {
  return OFFLINE_CAP_HOURS + perkBonus('longNap') + (projectDone('railway') ? 4 : 0) + total((b) => defOf(b).offlineHoursPerWorker?.(b.level));
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
export function tavernMood(tavern: PlacedBuilding, gap: number, counts = workerCounts(), wet = wateredTiles()): number {
  const effect = defOf(tavern).moodPerWorker;
  if (!effect || gap > effect.radius || !isWorking(tavern, wet)) return 0;
  return effect.amount(tavern.level) * (counts.get(tavern.id) ?? 0);
}
