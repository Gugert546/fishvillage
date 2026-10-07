// All tunable game numbers live here so balancing never means hunting through scene code.

export const GAME_WIDTH = 450;
/** Height follows the screen's aspect ratio so tall phones fill without black bars. */
export const GAME_HEIGHT = Math.round(
  Math.min(1000, Math.max(720, (GAME_WIDTH * window.innerHeight) / Math.max(1, window.innerWidth))),
);

/** Pixels per meter of depth. */
export const PX_PER_M = 16;
/** World y of the water surface. */
export const SURFACE_Y = 260;

// ---------------------------------------------------------------- Depth zones

export interface Zone {
  name: string;
  /** Depth in meters where this zone starts. */
  from: number;
  color: number;
}

export const ZONES: Zone[] = [
  { name: 'Shallows', from: 0, color: 0x3fa7d6 },
  { name: 'Open Water', from: 50, color: 0x2378b5 },
  { name: 'The Deep', from: 120, color: 0x124a80 },
  { name: 'Abyss', from: 200, color: 0x081d3d },
];

/** Deepest point fish spawn (meters). */
export const WORLD_DEPTH_M = 280;

// ---------------------------------------------------------------------- Fish

export interface FishType {
  id: string;
  name: string;
  value: number;
  /** Depth range in meters where this fish can spawn. */
  minDepth: number;
  maxDepth: number;
  /** Relative spawn weight within its range. */
  weight: number;
  /** Horizontal swim speed range, px/s. */
  speed: [number, number];
  /** Body size in px. */
  width: number;
  height: number;
  color: number;
  /** Swims with a wobbly up-and-down path. */
  erratic?: boolean;
}

export const FISH: FishType[] = [
  { id: 'sardine', name: 'Sardine', value: 2, minDepth: 2, maxDepth: 45, weight: 10, speed: [30, 60], width: 26, height: 12, color: 0xc7d3e0 },
  { id: 'mackerel', name: 'Mackerel', value: 5, minDepth: 8, maxDepth: 70, weight: 7, speed: [50, 90], width: 34, height: 14, color: 0x5fb3e8 },
  { id: 'cod', name: 'Cod', value: 12, minDepth: 35, maxDepth: 110, weight: 6, speed: [35, 60], width: 44, height: 20, color: 0xb59f6a },
  { id: 'salmon', name: 'Salmon', value: 25, minDepth: 55, maxDepth: 140, weight: 5, speed: [70, 110], width: 46, height: 18, color: 0xf2906e },
  { id: 'tuna', name: 'Tuna', value: 60, minDepth: 100, maxDepth: 220, weight: 4, speed: [100, 150], width: 58, height: 24, color: 0x3a5fa8 },
  { id: 'angler', name: 'Anglerfish', value: 150, minDepth: 160, maxDepth: 280, weight: 3, speed: [40, 80], width: 40, height: 28, color: 0x7a4f8c, erratic: true },
];

/** Average fish per 10 m of depth. */
export const FISH_DENSITY = 1.7;

// ------------------------------------------------------------------- Fishing

export interface FishingStats {
  /** Max line length in meters. */
  lineLength: number;
  /** Fish the hook can carry back up. */
  capacity: number;
  /** Fish you can brush past on the way down without stopping. */
  shields: number;
  /** Descent speed, m/s. */
  descentSpeed: number;
  /** Ascent speed, m/s. */
  ascentSpeed: number;
}

export const BASE_STATS: FishingStats = {
  lineLength: 40,
  capacity: 3,
  shields: 0,
  descentSpeed: 7,
  ascentSpeed: 9,
};

/** How fast the hook follows your finger sideways, px/s. */
export const HOOK_STEER_SPEED = 1100;
export const HOOK_RADIUS = 9;

// ------------------------------------------------------------------ Upgrades
// Fishing gear, sold by shops in town. A shop's level caps how far each upgrade can go.

export type UpgradeId = 'line' | 'capacity' | 'shield' | 'reel';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  describe: (level: number) => string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Building that sells this upgrade. */
  shop: BuildingId;
  /** Upgrade levels unlocked per shop level. */
  levelsPerShopLevel: number;
  apply: (stats: FishingStats, level: number) => void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'line',
    name: 'Longer Line',
    describe: (l) => `${BASE_STATS.lineLength + l * 15} m`,
    baseCost: 20,
    costGrowth: 1.6,
    maxLevel: 16,
    shop: 'tackleShop',
    levelsPerShopLevel: 4,
    apply: (s, l) => (s.lineLength += l * 15),
  },
  {
    id: 'capacity',
    name: 'Bigger Hook',
    describe: (l) => `${BASE_STATS.capacity + l} fish`,
    baseCost: 25,
    costGrowth: 1.55,
    maxLevel: 20,
    shop: 'tackleShop',
    levelsPerShopLevel: 4,
    apply: (s, l) => (s.capacity += l),
  },
  {
    id: 'reel',
    name: 'Faster Reel',
    describe: (l) => `${(BASE_STATS.descentSpeed + l * 1.2).toFixed(1)} m/s`,
    baseCost: 30,
    costGrowth: 1.5,
    maxLevel: 10,
    shop: 'tackleShop',
    levelsPerShopLevel: 2,
    apply: (s, l) => {
      s.descentSpeed += l * 1.2;
      s.ascentSpeed += l * 1.4;
    },
  },
  {
    id: 'shield',
    name: 'Lucky Lure',
    describe: (l) => `dodge ${l} hit${l === 1 ? '' : 's'}`,
    baseCost: 120,
    costGrowth: 3,
    maxLevel: 3,
    shop: 'baitShop',
    levelsPerShopLevel: 1,
    apply: (s, l) => (s.shields += l),
  },
];

export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
}

// --------------------------------------------------------------------- Town

export const TOWN_COLS = 7;
export const TILE = 60;
/** Left edge of the grid in world px. */
export const GRID_X = (GAME_WIDTH - TOWN_COLS * TILE) / 2;
export const START_ROWS = 5;
export const ROWS_PER_EXPANSION = 2;
export const MAX_ROWS = 40;
export const expansionCost = (expansions: number) => Math.round(150 * Math.pow(1.9, expansions));

/** Share of what you spent on a building that you get back when selling it. */
export const SELL_REFUND = 0.5;

/** Passive income keeps accruing while the game is closed, up to this long. */
export const OFFLINE_CAP_HOURS = 4;

// ---------------------------------------------------------------- Buildings

export type BuildingId = 'fishStand' | 'tackleShop' | 'baitShop';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  /** Footprint in tiles. */
  w: number;
  h: number;
  wall: number;
  roof: number;
  /** Price of the first one; each extra one costs costGrowth times more. */
  baseCost: number;
  costGrowth: number;
  maxCount: number;
  maxLevel: number;
  /** Coins per second at a given level. */
  income: (level: number) => number;
  /** Cost to go from `level` to `level + 1`. */
  upgradeCost: (level: number) => number;
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'fishStand',
    name: 'Fish Stand',
    description: 'Sells fish to passers-by. Earns coins over time.',
    w: 1,
    h: 1,
    wall: 0xe9d8a6,
    roof: 0x2a9d8f,
    baseCost: 50,
    costGrowth: 1.5,
    maxCount: 12,
    maxLevel: 10,
    income: (l) => 0.5 * l * Math.pow(1.15, l - 1),
    upgradeCost: (l) => Math.round(40 * Math.pow(1.7, l)),
  },
  {
    id: 'tackleShop',
    name: 'Tackle Shop',
    description: 'Sells longer lines, bigger hooks and faster reels.',
    w: 2,
    h: 2,
    wall: 0xd4a373,
    roof: 0x9d4b3a,
    baseCost: 150,
    costGrowth: 1,
    maxCount: 1,
    maxLevel: 5,
    income: () => 0,
    upgradeCost: (l) => Math.round(300 * Math.pow(2.5, l - 1)),
  },
  {
    id: 'baitShop',
    name: 'Bait Shop',
    description: 'Sells Lucky Lures and earns a little on the side.',
    w: 1,
    h: 1,
    wall: 0xcdb4db,
    roof: 0x5e548e,
    baseCost: 120,
    costGrowth: 1,
    maxCount: 1,
    maxLevel: 3,
    income: (l) => 0.2 * l,
    upgradeCost: (l) => Math.round(400 * Math.pow(3, l - 1)),
  },
];

export const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
