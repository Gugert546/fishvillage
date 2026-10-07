// Town rules: where buildings fit, what things cost, and what the shops allow.

import {
  BUILDING_BY_ID,
  MAX_ROWS,
  ROWS_PER_EXPANSION,
  SELL_REFUND,
  START_ROWS,
  TOWN_COLS,
  expansionCost,
  upgradeCost,
  type BuildingDef,
  type BuildingId,
  type UpgradeDef,
} from './config';
import { assignJobs, evictFrom, housingOf, jobSlots, shopOpen, tickPopulation, totalJobs } from './population';
import { needsStarterResidents, save, state, type PlacedBuilding } from './state';

export function townRows(): number {
  return Math.min(MAX_ROWS, START_ROWS + state.expansions * ROWS_PER_EXPANSION);
}

export function canExpand(): boolean {
  return townRows() < MAX_ROWS;
}

export function nextExpansionCost(): number {
  return expansionCost(state.expansions);
}

export function expand(): boolean {
  const cost = nextExpansionCost();
  if (!canExpand() || state.coins < cost) return false;
  state.coins -= cost;
  state.expansions++;
  save();
  return true;
}

export function countOwned(type: BuildingId): number {
  return state.buildings.filter((b) => b.type === type).length;
}

export function buildCost(def: BuildingDef): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, countOwned(def.id)));
}

export function canPlace(def: BuildingDef, col: number, row: number, ignore?: PlacedBuilding): boolean {
  if (col < 0 || row < 0 || col + def.w > TOWN_COLS || row + def.h > townRows()) return false;
  return !state.buildings.some((b) => {
    if (b === ignore) return false;
    const other = BUILDING_BY_ID[b.type];
    return col < b.col + other.w && b.col < col + def.w && row < b.row + other.h && b.row < row + def.h;
  });
}

export function placeBuilding(def: BuildingDef, col: number, row: number): PlacedBuilding | undefined {
  const cost = buildCost(def);
  if (state.coins < cost || countOwned(def.id) >= def.maxCount || !canPlace(def, col, row)) return undefined;
  state.coins -= cost;
  const building: PlacedBuilding = { id: state.nextBuildingId++, type: def.id, col, row, level: 1, spent: cost };
  state.buildings.push(building);
  assignJobs();
  save();
  return building;
}

export function upgradeBuilding(b: PlacedBuilding): boolean {
  const def = BUILDING_BY_ID[b.type];
  const cost = def.upgradeCost(b.level);
  if (b.level >= def.maxLevel || state.coins < cost) return false;
  state.coins -= cost;
  b.spent = totalSpent(b) + cost;
  b.level++;
  assignJobs();
  save();
  return true;
}

/** What has gone into a building so far; estimated for buildings from saves before tracking. */
function totalSpent(b: PlacedBuilding): number {
  if (b.spent !== undefined) return b.spent;
  const def = BUILDING_BY_ID[b.type];
  let total = def.baseCost;
  for (let l = 1; l < b.level; l++) total += def.upgradeCost(l);
  return total;
}

export function sellValue(b: PlacedBuilding): number {
  return Math.floor(totalSpent(b) * SELL_REFUND);
}

export function sellBuilding(b: PlacedBuilding): number {
  const value = sellValue(b);
  evictFrom(b);
  state.buildings = state.buildings.filter((other) => other !== b);
  assignJobs();
  state.coins += value;
  save();
  return value;
}

export function moveBuilding(b: PlacedBuilding, col: number, row: number): boolean {
  if (!canPlace(BUILDING_BY_ID[b.type], col, row, b)) return false;
  b.col = col;
  b.row = row;
  save();
  return true;
}

/** Highest level of a building type you own, 0 if none. */
export function shopLevel(type: BuildingId): number {
  return state.buildings.reduce((max, b) => (b.type === type ? Math.max(max, b.level) : max), 0);
}

/** How far an upgrade can currently go, given the level of the shop that sells it. */
export function upgradeLevelCap(def: UpgradeDef): number {
  return Math.min(def.maxLevel, shopLevel(def.shop) * def.levelsPerShopLevel);
}

export function buyUpgrade(def: UpgradeDef): boolean {
  const level = state.upgrades[def.id];
  const cost = upgradeCost(def, level);
  if (!shopOpen(def.shop) || level >= upgradeLevelCap(def) || state.coins < cost) return false;
  state.coins -= cost;
  state.upgrades[def.id]++;
  save();
  return true;
}

/** Player's staffing choice for a workplace; clamped to 0..slots. */
export function setStaff(b: PlacedBuilding, staff: number): void {
  const slots = jobSlots(b);
  const n = Math.max(0, Math.min(slots, staff));
  // "As many as fit" is stored as undefined so the building fills new slots after upgrades.
  b.staff = n >= slots ? undefined : n;
  assignJobs();
  save();
}

export function togglePriority(b: PlacedBuilding): void {
  b.priority = !b.priority;
  assignJobs();
  save();
}

/** First free spot for a footprint, searching rows outward from `nearRow`. */
export function findFreeSpot(def: BuildingDef, nearRow = 0): { col: number; row: number } | undefined {
  const rows = townRows();
  const center = Math.max(0, Math.min(rows - 1, nearRow));
  for (let d = 0; d < rows; d++) {
    for (const row of d === 0 ? [center] : [center - d, center + d]) {
      if (row < 0 || row >= rows) continue;
      for (let col = 0; col < TOWN_COLS; col++) if (canPlace(def, col, row)) return { col, row };
    }
  }
  return undefined;
}

/**
 * Saves from before residents existed would suddenly earn nothing, so give them free cottages
 * with enough residents to staff what they've built.
 */
export function grantStarterResidents(): void {
  if (!needsStarterResidents) return;
  const cottage = BUILDING_BY_ID.cottage;
  let needed = totalJobs();
  while (needed > 0) {
    const spot = findFreeSpot(cottage);
    if (!spot) break;
    const home: PlacedBuilding = { id: state.nextBuildingId++, type: 'cottage', ...spot, level: 1, spent: 0 };
    state.buildings.push(home);
    needed -= housingOf(home);
  }
  // Fill the new homes right away instead of waiting for move-ins.
  tickPopulation(1e9);
  save();
}
