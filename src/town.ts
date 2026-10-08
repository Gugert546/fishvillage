// Town rules: where buildings fit, what things cost, and what the shops allow.

import {
  AREA_BY_ID,
  BAITS,
  BUILDING_BY_ID,
  BUILDINGS,
  MAX_ROWS,
  PLAYER_HOUSE_SPOT,
  TOWN_LEVELS,
  ROWS_PER_EXPANSION,
  SELL_REFUND,
  START_ROWS,
  TOWN_COLS,
  expansionCost,
  upgradeCost,
  type AreaDef,
  type BaitDef,
  type BuildingDef,
  type BuildingId,
  type MerchantItemId,
  type UpgradeDef,
} from './config';
import { assignJobs, evictFrom, housingOf, jobSlots, shopOpen, tickPopulation, totalJobs, workerCounts } from './population';
import { questEvent } from './quests';
import { isWorking, touchesWater, wateredTiles } from './water';
import { discovered } from './logbook';
import { weather } from './world';
import { projectDone } from './projects';
import { fishName, hasFish, payUpgradeFish, upgradeNeed } from './crates';
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

/** How many of a building you may own right now, given the town level. */
export function countCap(def: BuildingDef): number {
  // Merchant decorations: one for each bought.
  if (def.merchantOnly) return state.merchantBought[def.id as MerchantItemId] ?? 0;
  return def.countAtLevel ? Math.min(def.maxCount, def.countAtLevel(townLevel())) : def.maxCount;
}

/** Highest level a building can be upgraded to right now: its own max, and never past the town level. */
export function levelCap(b: PlacedBuilding): number {
  const def = BUILDING_BY_ID[b.type];
  return b.type === 'playerHouse' ? def.maxLevel : Math.min(def.maxLevel, townLevel());
}

export function buildCost(def: BuildingDef): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, countOwned(def.id)));
}

export type PlacementProblem = 'outside' | 'taken' | 'water' | 'noCanal';

/** Why a building can't go here, or undefined if it can. */
export function placementProblem(
  def: BuildingDef,
  col: number,
  row: number,
  ignore?: PlacedBuilding,
): PlacementProblem | undefined {
  if (col < 0 || row < 0 || col + def.w > TOWN_COLS || row + def.h > townRows()) return 'outside';
  const overlapping = state.buildings.filter((b) => {
    if (b === ignore) return false;
    const other = BUILDING_BY_ID[b.type];
    return col < b.col + other.w && b.col < col + def.w && row < b.row + other.h && b.row < row + def.h;
  });
  // Bridges are the one thing that goes on top of something else: a canal.
  if (def.id === 'bridge') {
    if (!overlapping.some((b) => b.type === 'canal')) return 'noCanal';
    return overlapping.every((b) => b.type === 'canal') ? undefined : 'taken';
  }
  if (overlapping.length > 0) return 'taken';
  if (def.needsWater && !touchesWater({ id: -1, type: def.id, col, row, level: 1 })) return 'water';
  return undefined;
}

export function canPlace(def: BuildingDef, col: number, row: number, ignore?: PlacedBuilding): boolean {
  return placementProblem(def, col, row, ignore) === undefined;
}

export function placeBuilding(def: BuildingDef, col: number, row: number): PlacedBuilding | undefined {
  const cost = buildCost(def);
  if (!isUnlocked(def) || state.coins < cost || countOwned(def.id) >= countCap(def) || !canPlace(def, col, row)) {
    return undefined;
  }
  state.coins -= cost;
  const building: PlacedBuilding = { id: state.nextBuildingId++, type: def.id, col, row, level: 1, spent: cost };
  state.buildings.push(building);
  if (def.landmark && !state.landmarks.includes(def.id)) state.landmarks.push(def.id);
  assignJobs();
  questEvent({ type: 'placed', building: def.id });
  save();
  return building;
}

export function upgradeBuilding(b: PlacedBuilding): boolean {
  const def = BUILDING_BY_ID[b.type];
  const cost = def.upgradeCost(b.level);
  if (b.level >= levelCap(b) || state.coins < cost) return false;
  if (b.type === 'playerHouse' && houseUpgradeBlockers().length > 0) return false;
  const need = upgradeNeed(b);
  if (need && !hasFish(need)) return false;
  payUpgradeFish(b);
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
  return Math.floor(totalSpent(b) * (BUILDING_BY_ID[b.type].refund ?? SELL_REFUND));
}

export function canSell(b: PlacedBuilding): boolean {
  return b.type !== 'playerHouse';
}

export function sellBuilding(b: PlacedBuilding): number {
  if (!canSell(b)) return 0;
  let value = sellValue(b);
  evictFrom(b);
  state.buildings = state.buildings.filter((other) => other !== b);
  // Filling in a canal takes any bridge over it along.
  if (b.type === 'canal') {
    const bridge = state.buildings.find((x) => x.type === 'bridge' && x.col === b.col && x.row === b.row);
    if (bridge) {
      value += sellValue(bridge);
      state.buildings = state.buildings.filter((other) => other !== bridge);
    }
  }
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

// ---------------------------------------------------------------- Town level

export function playerHouse(): PlacedBuilding | undefined {
  return state.buildings.find((b) => b.type === 'playerHouse');
}

/** The town level is your house's level. */
export function townLevel(): number {
  return playerHouse()?.level ?? 1;
}

export function isUnlocked(def: BuildingDef): boolean {
  if (def.trophy && !discovered(def.trophy)) return false;
  return townLevel() >= (def.unlockLevel ?? 1);
}

/** Buildings that the next house level would unlock. */
export function unlocksAt(level: number): BuildingDef[] {
  return BUILDINGS.filter((d) => (d.unlockLevel ?? 1) === level && d.category !== 'player');
}

/** Why the house can't be upgraded yet, besides coins (empty when it can). */
export function houseUpgradeBlockers(): string[] {
  const next = TOWN_LEVELS[townLevel() + 1];
  if (!next) return [];
  const blockers: string[] = [];
  if (state.residents.length < next.residents) blockers.push(`${next.residents} residents`);
  if (next.fish && !hasFish(next.fish)) blockers.push(`${next.fish.amount} ${fishName(next.fish.fish)} on ice`);
  return blockers;
}

/**
 * Every town has your house. New games get it above the dock; older saves get it wherever it
 * fits, at a level that already covers everything they've built.
 */
export function ensurePlayerHouse(): void {
  if (playerHouse()) return;
  const def = BUILDING_BY_ID.playerHouse;
  const spot = canPlace(def, PLAYER_HOUSE_SPOT.col, PLAYER_HOUSE_SPOT.row)
    ? PLAYER_HOUSE_SPOT
    : findFreeSpot(def, PLAYER_HOUSE_SPOT.row);
  if (!spot) return; // No room at all; the town just behaves as level 1 until there is.
  const level = state.buildings.reduce((max, b) => Math.max(max, BUILDING_BY_ID[b.type].unlockLevel ?? 1), 1);
  state.buildings.push({ id: state.nextBuildingId++, type: 'playerHouse', ...spot, level, spent: 0 });
  save();
}

// ---------------------------------------------------------------------- Bait

export function baitUnlocked(bait: BaitDef): boolean {
  return townLevel() >= bait.unlockLevel;
}

export function buyBait(bait: BaitDef): boolean {
  if (!shopOpen('baitShop') || !baitUnlocked(bait) || state.coins < bait.packCost) return false;
  state.coins -= bait.packCost;
  state.bait[bait.id] = (state.bait[bait.id] ?? 0) + bait.packSize;
  // First bait of its kind gets picked automatically, so it's actually used.
  if (!state.selectedBait) state.selectedBait = bait.id;
  save();
  return true;
}

/** The bait the next cast will use: the selected one, if any is left. */
export function readyBait(): BaitDef | undefined {
  const id = state.selectedBait;
  return id && (state.bait[id] ?? 0) > 0 ? BAITS.find((b) => b.id === id) : undefined;
}

/** Cycles the dock's bait choice: none → each bait you own → none. */
export function cycleBait(): void {
  const owned = BAITS.filter((b) => (state.bait[b.id] ?? 0) > 0).map((b) => b.id);
  const order: (BaitDef['id'] | null)[] = [null, ...owned];
  const i = order.indexOf(state.selectedBait && owned.includes(state.selectedBait) ? state.selectedBait : null);
  state.selectedBait = order[(i + 1) % order.length];
  save();
}

/** Uses one of the ready bait for a cast and returns it, or undefined when fishing without. */
export function consumeBait(): BaitDef | undefined {
  const bait = readyBait();
  if (!bait) return undefined;
  state.bait[bait.id] = (state.bait[bait.id] ?? 0) - 1;
  save();
  return bait;
}

// --------------------------------------------------------------- Boats & areas

export function ownsArea(area: AreaDef): boolean {
  return area.cost === 0 || state.boats.includes(area.id);
}

/** Where the next cast happens: the chosen area if you own its boat, else the Harbor. */
/** Storms keep boats in port, unless the Breakwater is built. */
export function stormBound(): boolean {
  return weather() === 'storm' && !projectDone('breakwater');
}

export function currentArea(): AreaDef {
  if (stormBound()) return AREA_BY_ID.harbor;
  const area = AREA_BY_ID[state.area];
  return area && ownsArea(area) ? area : AREA_BY_ID.harbor;
}

export function boatUnlocked(area: AreaDef): boolean {
  return townLevel() >= area.unlockLevel;
}

/** The Boatyard builds boats while it has a worker and water beside it. */
export function boatyardOpen(): boolean {
  const counts = workerCounts();
  const wet = wateredTiles();
  return state.buildings.some((b) => b.type === 'boatyard' && (counts.get(b.id) ?? 0) > 0 && isWorking(b, wet));
}

export function buyBoat(area: AreaDef): boolean {
  if (ownsArea(area) || !boatUnlocked(area) || !boatyardOpen() || state.coins < area.cost) return false;
  state.coins -= area.cost;
  state.boats.push(area.id);
  save();
  return true;
}

export function sailTo(area: AreaDef): void {
  if (!ownsArea(area)) return;
  state.area = area.id;
  save();
}
