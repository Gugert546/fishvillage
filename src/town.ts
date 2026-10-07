// Town rules: where buildings fit, what things cost, and what the shops allow.

import {
  BUILDING_BY_ID,
  MAX_ROWS,
  ROWS_PER_EXPANSION,
  START_ROWS,
  TOWN_COLS,
  expansionCost,
  upgradeCost,
  type BuildingDef,
  type BuildingId,
  type UpgradeDef,
} from './config';
import { save, state, type PlacedBuilding } from './state';

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
  const building: PlacedBuilding = { id: state.nextBuildingId++, type: def.id, col, row, level: 1 };
  state.buildings.push(building);
  save();
  return building;
}

export function upgradeBuilding(b: PlacedBuilding): boolean {
  const def = BUILDING_BY_ID[b.type];
  const cost = def.upgradeCost(b.level);
  if (b.level >= def.maxLevel || state.coins < cost) return false;
  state.coins -= cost;
  b.level++;
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
  if (level >= upgradeLevelCap(def) || state.coins < cost) return false;
  state.coins -= cost;
  state.upgrades[def.id]++;
  save();
  return true;
}
