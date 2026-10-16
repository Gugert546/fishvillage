// Tourists: the Ferry Terminal brings visitors who stroll about and spend at the shops. How many
// come depends on the terminal's staff and level, and on how lovely the town is.

import { ARRANGEMENT, BUILDING_BY_ID, TOURISM } from './config';
import { arrangementTypes } from './arrangements';
import { festivalActive } from './festival';
import { townHappiness } from './happiness';
import { defOf, jobSlots, workerCounts } from './population';
import { state, type PlacedBuilding } from './state';
import { townLevel } from './town';
import { isWorking, wateredTiles } from './water';

/** The terminal, if it's open: staffed and beside water. */
export function ferry(): PlacedBuilding | undefined {
  const b = state.buildings.find((x) => x.type === 'ferryTerminal');
  if (!b || !isWorking(b, wateredTiles())) return undefined;
  return (workerCounts().get(b.id) ?? 0) > 0 ? b : undefined;
}

/** How appealing the town is to visitors (multiplies the crowd). */
export function attraction(happiness = townHappiness()): number {
  let a = 1 + (TOURISM.happinessWeight * ((happiness ?? 50) - 50)) / 50;
  for (const b of state.buildings) {
    const def = defOf(b);
    if (def.landmark) a += TOURISM.perLandmark;
    if (def.trophy) a += TOURISM.perTrophy;
    if (def.speciesIncomePerWorker) a += TOURISM.aquarium;
  }
  // A beautiful town draws a crowd: each different arrangement type adds a little.
  a += Math.min(ARRANGEMENT.maxAppeal, arrangementTypes().size * ARRANGEMENT.appealPerType);
  if (festivalActive()) a *= TOURISM.festival;
  return Math.max(0.2, Math.min(TOURISM.maxAttraction, a));
}

/** Tourists in town right now (a steady crowd, so it keeps going while you're away). */
export function touristCount(happiness?: number | null): number {
  const b = ferry();
  if (!b) return 0;
  const capacity = BUILDING_BY_ID.ferryTerminal.tourists?.(b.level) ?? 0;
  const staffed = (workerCounts().get(b.id) ?? 0) / Math.max(1, jobSlots(b));
  return Math.round(capacity * staffed * attraction(happiness ?? undefined));
}

export const spendPerTourist = (): number => TOURISM.spendBase + TOURISM.spendPerLevel * townLevel();

/** Coins per minute the tourists spend. */
export function tourismIncome(happiness?: number | null): number {
  return touristCount(happiness) * spendPerTourist();
}
