// Playtesting helpers. Everything here only does anything in dev builds (npm run dev); a shipped
// game always pays full price.

import { AREAS, BAITS, FISH, MAX_TOWN_LEVEL, RODS, UPGRADES } from './config';
import { crateSpace, storeFish } from './crates';
import { save, state } from './state';
import { ownsArea, playerHouse } from './town';

export const DEV = import.meta.env.DEV;

/** Free mode (dev only, on by default): buildings, upgrades, gear and fees cost nothing. */
export const freeMode = (): boolean => DEV && state.settings.devFree !== false;

export function setFreeMode(on: boolean): void {
  state.settings.devFree = on;
  save();
}

/** Whether you can pay `cost` (always, in free mode). */
export const canAfford = (cost: number): boolean => freeMode() || state.coins >= cost;

/** Pays `cost` (nothing in free mode). */
export function spend(cost: number): void {
  if (!freeMode()) state.coins -= cost;
}

/** Jumps your house (and so the town) to the top level. */
export function devMaxTownLevel(): void {
  const house = playerHouse();
  if (house) house.level = MAX_TOWN_LEVEL;
  save();
}

/** Every boat and rod, fishing gear maxed out and a stack of every bait. */
export function devUnlockGear(): void {
  state.boats = AREAS.filter((a) => a.boat).map((a) => a.id);
  state.rods = RODS.map((r) => r.id);
  for (const up of UPGRADES) state.upgrades[up.id] = up.maxLevel;
  for (const bait of BAITS) state.bait[bait.id] = (state.bait[bait.id] ?? 0) + 20;
  save();
}

/** The legendary is waiting on your next cast (wherever you fish). */
export function devLegendNextCast(): void {
  state.charms.goldenLure = (state.charms.goldenLure ?? 0) + 1;
  save();
}

/** Fills the barrels with a random mix of fish from areas you can sail to. */
export function devFillBarrels(): void {
  const pool = FISH.filter((f) => !f.legendary && ownsArea(AREAS.find((a) => a.id === f.area)!));
  while (crateSpace() > 0) storeFish(pool[Math.floor(Math.random() * pool.length)].id, 1);
  save();
}
