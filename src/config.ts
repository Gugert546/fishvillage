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

// ---------------------------------------------------------------------- Fish

export interface FishType {
  id: string;
  name: string;
  /** Fishing area this fish lives in. */
  area: AreaId;
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
  /** Extra detail on the programmer art. */
  look?: 'bill' | 'stripes' | 'squid' | 'crab' | 'flat';
  /** One per area: rare, slippery, and worth a trophy. Never spawns as a regular fish. */
  legendary?: boolean;
}

export const FISH: FishType[] = [
  { id: 'sardine', name: 'Sardine', area: 'harbor', value: 2, minDepth: 2, maxDepth: 45, weight: 10, speed: [30, 60], width: 26, height: 12, color: 0xc7d3e0 },
  { id: 'mackerel', name: 'Mackerel', area: 'harbor', value: 5, minDepth: 8, maxDepth: 70, weight: 7, speed: [50, 90], width: 34, height: 14, color: 0x5fb3e8 },
  { id: 'cod', name: 'Cod', area: 'harbor', value: 12, minDepth: 35, maxDepth: 110, weight: 6, speed: [35, 60], width: 44, height: 20, color: 0xb59f6a },
  { id: 'salmon', name: 'Salmon', area: 'harbor', value: 25, minDepth: 55, maxDepth: 140, weight: 5, speed: [70, 110], width: 46, height: 18, color: 0xf2906e },
  { id: 'tuna', name: 'Tuna', area: 'harbor', value: 60, minDepth: 100, maxDepth: 220, weight: 4, speed: [100, 150], width: 58, height: 24, color: 0x3a5fa8 },
  { id: 'angler', name: 'Anglerfish', area: 'harbor', value: 150, minDepth: 160, maxDepth: 280, weight: 3, speed: [40, 80], width: 40, height: 28, color: 0x7a4f8c, erratic: true },
  // Open Sea
  { id: 'herring', name: 'Herring', area: 'openSea', value: 6, minDepth: 2, maxDepth: 60, weight: 10, speed: [50, 90], width: 30, height: 13, color: 0x9fb8c8 },
  { id: 'seaBass', name: 'Sea Bass', area: 'openSea', value: 15, minDepth: 15, maxDepth: 110, weight: 7, speed: [40, 70], width: 42, height: 18, color: 0x6c7a89 },
  { id: 'mahi', name: 'Mahi-mahi', area: 'openSea', value: 35, minDepth: 40, maxDepth: 160, weight: 6, speed: [110, 160], width: 48, height: 20, color: 0x4cc38a },
  { id: 'swordfish', name: 'Swordfish', area: 'openSea', value: 90, minDepth: 110, maxDepth: 240, weight: 4, speed: [130, 180], width: 60, height: 18, color: 0x51607a, look: 'bill' },
  { id: 'marlin', name: 'Marlin', area: 'openSea', value: 220, minDepth: 180, maxDepth: 280, weight: 3, speed: [140, 200], width: 70, height: 22, color: 0x2b4c8c, look: 'bill' },
  // Coral Reef
  { id: 'clownfish', name: 'Clownfish', area: 'reef', value: 10, minDepth: 2, maxDepth: 60, weight: 10, speed: [30, 60], width: 24, height: 14, color: 0xff7f2a, look: 'stripes' },
  { id: 'blueTang', name: 'Blue Tang', area: 'reef', value: 22, minDepth: 10, maxDepth: 100, weight: 8, speed: [50, 90], width: 30, height: 18, color: 0x2a6fdb },
  { id: 'parrotfish', name: 'Parrotfish', area: 'reef', value: 45, minDepth: 30, maxDepth: 140, weight: 6, speed: [40, 70], width: 40, height: 20, color: 0x3ec7a8 },
  { id: 'lionfish', name: 'Lionfish', area: 'reef', value: 90, minDepth: 70, maxDepth: 180, weight: 4, speed: [30, 50], width: 36, height: 24, color: 0xd9534f, erratic: true, look: 'stripes' },
  { id: 'grouper', name: 'Grouper', area: 'reef', value: 160, minDepth: 120, maxDepth: 220, weight: 3, speed: [25, 45], width: 56, height: 28, color: 0x8a6d4a },
  // Deep Trench
  { id: 'hatchetfish', name: 'Hatchetfish', area: 'trench', value: 25, minDepth: 5, maxDepth: 120, weight: 9, speed: [40, 80], width: 26, height: 18, color: 0xb8c4d6 },
  { id: 'gulper', name: 'Gulper Eel', area: 'trench', value: 70, minDepth: 60, maxDepth: 220, weight: 6, speed: [30, 60], width: 54, height: 14, color: 0x5a4a6e, erratic: true },
  { id: 'viperfish', name: 'Viperfish', area: 'trench', value: 140, minDepth: 140, maxDepth: 300, weight: 5, speed: [60, 100], width: 44, height: 16, color: 0x3a6a9a },
  { id: 'giantSquid', name: 'Giant Squid', area: 'trench', value: 350, minDepth: 240, maxDepth: 400, weight: 3, speed: [30, 60], width: 56, height: 26, color: 0xb5443b, look: 'squid' },
  { id: 'coelacanth', name: 'Coelacanth', area: 'trench', value: 700, minDepth: 320, maxDepth: 400, weight: 1.5, speed: [25, 45], width: 62, height: 26, color: 0x4a5d73 },
  // Arctic Waters
  { id: 'arcticChar', name: 'Arctic Char', area: 'arctic', value: 40, minDepth: 2, maxDepth: 90, weight: 9, speed: [50, 90], width: 34, height: 15, color: 0xe38b6d },
  { id: 'snowCrab', name: 'Snow Crab', area: 'arctic', value: 110, minDepth: 60, maxDepth: 180, weight: 6, speed: [15, 30], width: 34, height: 20, color: 0xd9663f, look: 'crab' },
  { id: 'halibut', name: 'Halibut', area: 'arctic', value: 180, minDepth: 100, maxDepth: 240, weight: 5, speed: [25, 45], width: 56, height: 18, color: 0x8a7f6a, look: 'flat' },
  { id: 'wolffish', name: 'Wolffish', area: 'arctic', value: 320, minDepth: 170, maxDepth: 280, weight: 3, speed: [40, 70], width: 52, height: 20, color: 0x5c6b78 },
  { id: 'ghostFish', name: 'Ghost Fish', area: 'arctic', value: 900, minDepth: 230, maxDepth: 280, weight: 1, speed: [50, 90], width: 40, height: 18, color: 0xe8f4ff, erratic: true },
  // Legendaries, one per area
  { id: 'oldBarnacle', name: 'Old Barnacle', area: 'harbor', value: 1500, minDepth: 150, maxDepth: 270, weight: 0, speed: [70, 100], width: 64, height: 30, color: 0x8d7b68, legendary: true, look: 'flat' },
  { id: 'silverKing', name: 'Silver King', area: 'openSea', value: 4000, minDepth: 160, maxDepth: 270, weight: 0, speed: [150, 210], width: 76, height: 24, color: 0xdfe7ef, legendary: true, look: 'bill' },
  { id: 'coralEmperor', name: 'Coral Emperor', area: 'reef', value: 5000, minDepth: 120, maxDepth: 210, weight: 0, speed: [90, 130], width: 54, height: 32, color: 0xff5d8f, legendary: true, look: 'stripes' },
  { id: 'lanternKing', name: 'Lantern King', area: 'trench', value: 10000, minDepth: 300, maxDepth: 390, weight: 0, speed: [60, 90], width: 58, height: 36, color: 0x9b5de5, legendary: true, erratic: true },
  { id: 'frostfin', name: 'Frostfin', area: 'arctic', value: 15000, minDepth: 200, maxDepth: 270, weight: 0, speed: [110, 160], width: 60, height: 24, color: 0xbde0fe, legendary: true },
];

/** Legendary fish: how often one shows up and how it slips away from the hook. */
export const LEGENDARY = {
  /** Chance per cast that the area's legendary is in the water. */
  chance: 0.25,
  /** It notices the hook this close (px) and darts away. */
  fleeRadius: 80,
  fleeSpeed: 330,
  fleeSeconds: 0.45,
};

/** Completing an area's logbook page (every regular species) makes fish there sell for this much more. */
export const LOGBOOK_PAGE_BONUS = 0.1;

// -------------------------------------------------------------- Fishing areas
// The Harbor is free; every other area needs its own boat, bought at the Boatyard.

export type AreaId = 'harbor' | 'openSea' | 'reef' | 'trench' | 'arctic';
export type HazardKind = 'shark' | 'jelly' | 'ice';

export interface AreaDef {
  id: AreaId;
  name: string;
  /** Boat that takes you there (none for the Harbor). */
  boat?: string;
  /** One line for the boat list. */
  blurb: string;
  unlockLevel: number;
  cost: number;
  /** Deepest point fish spawn (meters). */
  depth: number;
  /** Extra line the boat's winch lets out here, meters. */
  lineBonus: number;
  /** Average fish per 10 m of depth. */
  density: number;
  zones: Zone[];
  sky: number;
  /** Hazards that roam the water. */
  hazard?: { kind: HazardKind; perTenM: number; minDepth: number };
  /** Pitch black below the surface except right around the hook. */
  dark?: boolean;
  /** Boat colours for the programmer art. */
  hull?: number;
  cabin?: number;
}

export const AREAS: AreaDef[] = [
  {
    id: 'harbor', name: 'Harbor', blurb: 'Your dock by the village', unlockLevel: 1, cost: 0, depth: 280, lineBonus: 0, density: 1.7, sky: 0xa8def0,
    zones: [
      { name: 'Shallows', from: 0, color: 0x3fa7d6 },
      { name: 'Open Water', from: 50, color: 0x2378b5 },
      { name: 'The Deep', from: 120, color: 0x124a80 },
      { name: 'Abyss', from: 200, color: 0x081d3d },
    ],
  },
  {
    id: 'openSea', name: 'Open Sea', boat: 'Fishing Boat', blurb: 'Fast fish. Sharks bite fish off your hook!', unlockLevel: 5, cost: 25_000, depth: 280, lineBonus: 0, density: 1.6, sky: 0x8fd0f0,
    hazard: { kind: 'shark', perTenM: 0.35, minDepth: 30 }, hull: 0xd8dee4, cabin: 0x2f6690,
    zones: [
      { name: 'Surface', from: 0, color: 0x2d8fd0 },
      { name: 'Blue Water', from: 60, color: 0x1a63a8 },
      { name: 'Twilight', from: 150, color: 0x0e3a72 },
      { name: 'Deep Blue', from: 220, color: 0x061a3a },
    ],
  },
  {
    id: 'reef', name: 'Coral Reef', boat: 'Catamaran', blurb: 'Packed with fish. Jellyfish sting!', unlockLevel: 5, cost: 90_000, depth: 220, lineBonus: 0, density: 2.6, sky: 0xb5ecf5,
    hazard: { kind: 'jelly', perTenM: 0.5, minDepth: 10 }, hull: 0xffffff, cabin: 0xe76f51,
    zones: [
      { name: 'Lagoon', from: 0, color: 0x3ed3d0 },
      { name: 'Reef Wall', from: 60, color: 0x1fa6b8 },
      { name: 'Drop-off', from: 140, color: 0x16708f },
    ],
  },
  {
    id: 'trench', name: 'Deep Trench', boat: 'Trawler', blurb: 'Pitch dark, very deep. Winch: +120 m line', unlockLevel: 6, cost: 300_000, depth: 400, lineBonus: 120, density: 1.5, sky: 0x7d93a8,
    dark: true, hull: 0x3d5a80, cabin: 0xe0e1dd,
    zones: [
      { name: 'Surface', from: 0, color: 0x1f5f8b },
      { name: 'Midnight Zone', from: 60, color: 0x0b2545 },
      { name: 'The Trench', from: 200, color: 0x050d1f },
      { name: 'Hadal', from: 320, color: 0x02040a },
    ],
  },
  {
    id: 'arctic', name: 'Arctic Waters', boat: 'Icebreaker', blurb: 'Priciest fish. Ice floes block your line!', unlockLevel: 6, cost: 1_000_000, depth: 280, lineBonus: 0, density: 1.6, sky: 0xdcebf5,
    hazard: { kind: 'ice', perTenM: 0.4, minDepth: 8 }, hull: 0xc1121f, cabin: 0xf1f1f1,
    zones: [
      { name: 'Ice Shelf', from: 0, color: 0x6fb7d9 },
      { name: 'Cold Water', from: 70, color: 0x3a7ca5 },
      { name: 'Frozen Deep', from: 170, color: 0x1b3a5c },
    ],
  },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a])) as Record<AreaId, AreaDef>;

export const HAZARD_INFO: Record<HazardKind, { name: string; width: number; height: number; speed: [number, number] }> = {
  shark: { name: 'Shark', width: 78, height: 26, speed: [120, 170] },
  jelly: { name: 'Jellyfish', width: 26, height: 30, speed: [8, 20] },
  ice: { name: 'Ice floe', width: 90, height: 24, speed: [6, 16] },
};
/** Seconds the hook can't be steered after a jellyfish sting. */
export const STING_SECONDS = 1.1;

// ---------------------------------------------------------------------- Bait
// Bought in packs at the Bait Shop; one is used per cast. Bait raises what fish sell for and
// lures better fish: more fish overall, and some species much more often.

export type BaitId = 'worm' | 'shrimp' | 'squid' | 'glow';

export interface BaitDef {
  id: BaitId;
  name: string;
  /** Short line for the shop, e.g. "Lures Tuna". */
  lures: string;
  /** Town level needed to buy it. */
  unlockLevel: number;
  packSize: number;
  packCost: number;
  /** Extra sale price, e.g. 0.1 = +10%. */
  sellBonus: number;
  /** Multiplier on how many fish spawn. */
  density: number;
  /** Multipliers on spawn weight per fish id. */
  attract: Partial<Record<string, number>>;
  color: number;
}

export const BAITS: BaitDef[] = [
  { id: 'worm', name: 'Worms', lures: 'More bites', unlockLevel: 2, packSize: 5, packCost: 20, sellBonus: 0.1, density: 1.15, attract: {}, color: 0xe07a8f },
  { id: 'shrimp', name: 'Shrimp', lures: 'Lures Cod & Salmon', unlockLevel: 3, packSize: 5, packCost: 75, sellBonus: 0.15, density: 1.1, attract: { cod: 2, salmon: 2, seaBass: 2, parrotfish: 2, hatchetfish: 1.5 }, color: 0xf4a261 },
  { id: 'squid', name: 'Squid', lures: 'Lures Tuna', unlockLevel: 4, packSize: 5, packCost: 250, sellBonus: 0.2, density: 1.1, attract: { tuna: 2.5, salmon: 1.5, swordfish: 2, lionfish: 2, snowCrab: 2, giantSquid: 1.5 }, color: 0xcdb4db },
  { id: 'glow', name: 'Glow Bait', lures: 'Lures Anglerfish', unlockLevel: 5, packSize: 5, packCost: 800, sellBonus: 0.25, density: 1.1, attract: { angler: 4, tuna: 1.5, marlin: 2, grouper: 2, coelacanth: 2, ghostFish: 2 }, color: 0xb9fbc0 },
];

export const BAIT_BY_ID = Object.fromEntries(BAITS.map((b) => [b.id, b])) as Record<BaitId, BaitDef>;

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

/** Once the hook is full there's nothing left to do, so it reels in this many times faster. */
export const FULL_HOOK_REEL_MULTIPLIER = 4;
/** Seconds to ramp up to that speed, so the speed-up reads as "reeling in" rather than a jump. */
export const FULL_HOOK_RAMP_SECONDS = 0.5;

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

export const TOWN_COLS = 14;
export const TILE = 30;
/** Left edge of the grid in world px. */
export const GRID_X = (GAME_WIDTH - TOWN_COLS * TILE) / 2;
export const START_ROWS = 14;
export const ROWS_PER_EXPANSION = 4;
export const MAX_ROWS = 80;
export const expansionCost = (expansions: number) => Math.round(10_000 * Math.pow(1.5, expansions));

/** Share of what you spent on a building that you get back when selling it. */
export const SELL_REFUND = 0.5;

/** Passive income keeps accruing while the game is closed, up to this long. */
export const OFFLINE_CAP_HOURS = 4;

// --------------------------------------------------------------- Residents

/** Seconds between new residents arriving while there's free housing. */
export const MOVE_IN_SECONDS = 20;
/** The very first resident of an empty town arrives quickly. */
export const FIRST_MOVE_IN_SECONDS = 3;

// --------------------------------------------------------------- Happiness
// Each resident's happiness is 0–100: base + decor near home + road next to home ± job.
// 50% is neutral; above it residents earn more and newcomers arrive faster.

export const HAPPINESS = {
  base: 40,
  roadNextToHome: 10,
  /** Waterfront homes: next to a canal that's filled with water. */
  waterNextToHome: 5,
  employed: 10,
  unemployed: -10,
  /** Income multiplier for a worker at 0% and 100% happiness (1.0 at 50%). */
  incomeAtZero: 0.75,
  incomeAtFull: 1.5,
  /** Move-in speed multiplier at 0% and 100% happiness (1.0 at 50%). */
  moveInAtZero: 0.5,
  moveInAtFull: 1.5,
  /** Workplace income bonus when next to a road. */
  roadIncomeBonus: 0.1,
};

export const RESIDENT_NAMES = [
  'Ada', 'Bo', 'Cora', 'Dag', 'Elin', 'Finn', 'Greta', 'Hugo', 'Ida', 'Jon', 'Kari', 'Leif', 'Maja', 'Nils',
  'Olga', 'Per', 'Ragna', 'Siv', 'Tor', 'Ulla', 'Vera', 'Wilhelm', 'Yngve', 'Åse', 'Arne', 'Brit', 'Edvin',
  'Frida', 'Gunnar', 'Hedda', 'Ivar', 'Johanna', 'Knut', 'Liv', 'Magnus', 'Nora', 'Oskar', 'Petra', 'Sigrid',
  'Tove', 'Vidar', 'Astrid', 'Bjørn', 'Dina', 'Erik', 'Ingrid', 'Lars', 'Mette', 'Sander', 'Thea','Ragnhild','Audun'
];

// ---------------------------------------------------------------- Buildings

export type BuildingId =
  | 'playerHouse'
  | 'fishStand'
  | 'filletHouse'
  | 'warehouse'
  | 'tavern'
  | 'netMaker'
  | 'lighthouse'
  | 'tackleShop'
  | 'baitShop'
  | 'cottage'
  | 'apartment'
  | 'road'
  | 'canal'
  | 'bridge'
  | 'mooredBoats'
  | 'fishermansHut'
  | 'fishMarket'
  | 'waterMill'
  | 'boatyard'
  | 'bathhouse'
  | 'seafoodRestaurant'
  | 'flowerBed'
  | 'tree'
  | 'bench'
  | 'lampPost'
  | 'fountain'
  | 'aquarium'
  | 'cannery'
  | 'exportDocks'
  | 'statue'
  | 'clockTower'
  | 'grandLighthouse'
  | 'harborGate'
  | 'icehouse'
  | 'trophyOldBarnacle'
  | 'trophySilverKing'
  | 'trophyCoralEmperor'
  | 'trophyLanternKing'
  | 'trophyFrostfin';
/** `tile`: painted one-tile pieces (roads, canals) drawn as one connected layer. */
export type BuildingCategory = 'player' | 'work' | 'housing' | 'decor' | 'tile';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  category: BuildingCategory;
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
  /** Cost to go from `level` to `level + 1`. */
  upgradeCost: (level: number) => number;
  /** Workplaces: job slots at a given level. */
  jobs?: (level: number) => number;
  /** Workplaces: coins per minute each worker earns at a given level. */
  incomePerWorker?: (level: number) => number;
  /** Housing: residents that fit at a given level. */
  housing?: (level: number) => number;
  /** Decor: happiness added to homes within `radius` tiles of its edge. */
  happiness?: { amount: number; radius: number };
  /** Share of spent coins returned on sell; defaults to SELL_REFUND. */
  refund?: number;
  /** Player house level needed before this can be built (default 1). */
  unlockLevel?: number;
  /** If set, how many you may own at a given town level (still capped by maxCount). */
  countAtLevel?: (townLevel: number) => number;
  /** Processing: each worker raises all Fish Stand income by this share at a given level. */
  standBoostPerWorker?: (level: number) => number;
  /** Warehouse: hours each worker adds to the offline earnings cap. */
  offlineHoursPerWorker?: (level: number) => number;
  /** Tavern: happiness each worker adds to homes within `radius` tiles. */
  moodPerWorker?: { amount: (level: number) => number; radius: number };
  /** Net Maker: extra hook capacity per worker. */
  hookPerWorker?: number;
  /** Lighthouse: metres of sonar range per worker. */
  sonarPerWorker?: (level: number) => number;
  /** Build menu tab for workplaces that aren't shops. */
  menuTab?: 'services' | 'special';
  /** Must be placed right beside a filled canal, and stops working if the water goes away. */
  needsWater?: boolean;
  /** Fish Market: extra sale price at the dock per worker (0.05 = +5%). */
  dockPricePerWorker?: (level: number) => number;
  /** Water Mill: each worker makes earning workplaces within `radius` tiles earn this much more. */
  millPerWorker?: { amount: number; radius: number };
  /** Aquarium: coins per minute each worker earns per species in your logbook. */
  speciesIncomePerWorker?: (level: number) => number;
  /** Trophy decor: only buildable once this (legendary) fish has been caught. */
  trophy?: string;
  /** Icehouse: fish it can keep at a given level. */
  crateCapacity?: (level: number) => number;
  /** Cannery: spare fish each worker cans per minute. */
  cansPerWorker?: (level: number) => number;
  /** Export Docks: cans each worker loads onto a trade ship. */
  shipCansPerWorker?: (level: number) => number;
  /** One-off monument with a town-wide bonus (and a perk point). */
  landmark?: LandmarkEffect;
}

/** What a landmark does for the whole town. */
export interface LandmarkEffect {
  fishPrice?: number;
  income?: number;
  legendaryChance?: number;
  happiness?: number;
}

/** One extra job slot every second level: 1, 1, 2, 2, 3… */
const slotsEveryOtherLevel = (l: number) => 1 + Math.floor((l - 1) / 2);

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'cottage',
    name: 'Cottage',
    description: 'A cosy little home.',
    category: 'housing',
    w: 2,
    h: 2,
    wall: 0xf1e3c8,
    roof: 0xbc6c25,
    baseCost: 40,
    costGrowth: 1.25,
    maxCount: 40,
    maxLevel: 3,
    upgradeCost: (l) => Math.round(60 * Math.pow(1.8, l - 1)),
    housing: (l) => 1 + l,
  },
  {
    id: 'apartment',
    name: 'Apartment',
    description: 'Lots of homes on a small plot.',
    category: 'housing',
    w: 4,
    h: 4,
    wall: 0xc9ada7,
    roof: 0x4a4e69,
    baseCost: 400,
    costGrowth: 1.4,
    maxCount: 12,
    unlockLevel: 3,
    maxLevel: 5,
    upgradeCost: (l) => Math.round(350 * Math.pow(1.9, l - 1)),
    housing: (l) => 4 + 2 * l,
  },
  {
    id: 'fishStand',
    name: 'Fish Stand',
    description: 'Sells fish to passers-by.',
    category: 'work',
    w: 2,
    h: 2,
    wall: 0xe9d8a6,
    roof: 0x2a9d8f,
    baseCost: 50,
    costGrowth: 1.5,
    maxCount: 12,
    // 2 at town level 1, then one more per level.
    countAtLevel: (t) => 1 + t,
    maxLevel: 10,
    upgradeCost: (l) => Math.round(40 * Math.pow(1.7, l)),
    jobs: slotsEveryOtherLevel,
    incomePerWorker: (l) => 6 * Math.pow(1.15, l - 1),
  },
  {
    id: 'filletHouse',
    name: 'Fillet House',
    description: 'Fillets the catch, so every Fish Stand earns more.',
    category: 'work',
    w: 4,
    h: 2,
    wall: 0xdad7cd,
    roof: 0x3a5a40,
    baseCost: 400,
    costGrowth: 1,
    maxCount: 1,
    maxLevel: 3,
    unlockLevel: 3,
    upgradeCost: (l) => Math.round(900 * Math.pow(2.2, l - 1)),
    jobs: () => 4,
    standBoostPerWorker: (l) => 0.1 + 0.025 * (l - 1),
  },
  {
    id: 'tackleShop',
    name: 'Tackle Shop',
    description: 'Sells lines, hooks and reels. Needs a shopkeeper.',
    category: 'work',
    w: 4,
    h: 4,
    wall: 0xd4a373,
    roof: 0x9d4b3a,
    baseCost: 150,
    costGrowth: 1,
    maxCount: 1,
    maxLevel: 5,
    upgradeCost: (l) => Math.round(300 * Math.pow(2.5, l - 1)),
    jobs: slotsEveryOtherLevel,
    incomePerWorker: (l) => 4 * l,
  },
  {
    id: 'baitShop',
    name: 'Bait Shop',
    description: 'Sells bait and Lucky Lures. Needs a shopkeeper.',
    category: 'work',
    w: 2,
    h: 2,
    wall: 0xcdb4db,
    roof: 0x5e548e,
    baseCost: 120,
    costGrowth: 1,
    maxCount: 1,
    maxLevel: 3,
    unlockLevel: 2,
    upgradeCost: (l) => Math.round(400 * Math.pow(3, l - 1)),
    jobs: slotsEveryOtherLevel,
    incomePerWorker: (l) => 2.5 * l,
  },
];

const decor = (
  id: BuildingId,
  name: string,
  description: string,
  cost: number,
  amount: number,
  radius: number,
  size = 1,
  unlockLevel = 1,
): BuildingDef => ({
  id,
  name,
  description,
  category: 'decor',
  w: size,
  h: size,
  wall: 0,
  roof: 0,
  baseCost: cost,
  costGrowth: 1,
  maxCount: 200,
  maxLevel: 1,
  upgradeCost: () => 0,
  happiness: { amount, radius },
  unlockLevel,
});

// Services: they need staff but earn nothing directly; each worker helps the town another way.
const service = (
  def: Omit<BuildingDef, 'category' | 'costGrowth' | 'jobs' | 'menuTab'> & Partial<Pick<BuildingDef, 'costGrowth' | 'jobs'>>,
): BuildingDef => ({
  category: 'work',
  costGrowth: 1,
  jobs: () => 4,
  menuTab: 'services',
  ...def,
});

BUILDINGS.push(
  service({
    id: 'warehouse',
    name: 'Warehouse',
    description: 'Keeps you earning while away.',
    w: 4,
    h: 2,
    wall: 0xb08968,
    roof: 0x7f5539,
    baseCost: 1_500,
    maxCount: 1,
    maxLevel: 3,
    unlockLevel: 3,
    upgradeCost: (l) => Math.round(2_000 * Math.pow(2, l - 1)),
    offlineHoursPerWorker: (l) => 0.75 + 0.25 * l,
  }),
  service({
    id: 'tavern',
    name: 'Tavern',
    description: 'Food, music and gossip. Cheers up homes nearby.',
    w: 4,
    h: 2,
    wall: 0xe9c46a,
    roof: 0x6a040f,
    baseCost: 3_000,
    costGrowth: 1.5,
    maxCount: 3,
    maxLevel: 3,
    unlockLevel: 4,
    upgradeCost: (l) => Math.round(2_500 * Math.pow(2, l - 1)),
    moodPerWorker: { amount: (l) => 3 + l, radius: 5 },
  }),
  service({
    id: 'netMaker',
    name: 'Net Maker',
    description: 'Your hook holds more fish.',
    w: 4,
    h: 2,
    wall: 0x84a59d,
    roof: 0x284b63,
    baseCost: 8_000,
    maxCount: 1,
    maxLevel: 1,
    unlockLevel: 5,
    upgradeCost: () => 0,
    hookPerWorker: 1,
  }),
  service({
    id: 'lighthouse',
    name: 'Lighthouse',
    description: 'Its keepers run a fish sonar for your casts.',
    w: 2,
    h: 4,
    wall: 0xf8f9fa,
    roof: 0xd62828,
    baseCost: 25_000,
    maxCount: 1,
    maxLevel: 3,
    unlockLevel: 6,
    upgradeCost: (l) => Math.round(20_000 * Math.pow(2, l - 1)),
    sonarPerWorker: (l) => 5 + 5 * l,
  }),
);

// Waterside: must sit beside a filled canal.
BUILDINGS.push(
  {
    id: 'fishermansHut',
    name: "Fisherman's Hut",
    description: 'Its workers fish right from the canal.',
    category: 'work',
    w: 2,
    h: 2,
    wall: 0x9c6644,
    roof: 0x588157,
    baseCost: 300,
    costGrowth: 1.4,
    maxCount: 6,
    maxLevel: 5,
    unlockLevel: 3,
    needsWater: true,
    upgradeCost: (l) => Math.round(250 * Math.pow(1.8, l - 1)),
    jobs: () => 2,
    incomePerWorker: (l) => 9 * Math.pow(1.15, l - 1),
  },
  {
    id: 'seafoodRestaurant',
    name: 'Seafood Restaurant',
    description: 'Waterfront dining. Earns well and cheers up homes nearby.',
    category: 'work',
    w: 4,
    h: 2,
    wall: 0xfefae0,
    roof: 0x1d3557,
    baseCost: 30_000,
    costGrowth: 1.5,
    maxCount: 2,
    maxLevel: 3,
    unlockLevel: 6,
    needsWater: true,
    upgradeCost: (l) => Math.round(25_000 * Math.pow(2, l - 1)),
    jobs: () => 4,
    incomePerWorker: (l) => 20 * Math.pow(1.15, l - 1),
    moodPerWorker: { amount: () => 2, radius: 4 },
  },
  service({
    id: 'fishMarket',
    name: 'Fish Market',
    description: 'Boats unload here; your catch sells for more.',
    w: 4,
    h: 4,
    wall: 0xe9edc9,
    roof: 0xc1121f,
    baseCost: 5_000,
    maxCount: 1,
    maxLevel: 3,
    unlockLevel: 4,
    needsWater: true,
    upgradeCost: (l) => Math.round(6_000 * Math.pow(2, l - 1)),
    dockPricePerWorker: (l) => 0.04 + 0.01 * l,
  }),
  service({
    id: 'waterMill',
    name: 'Water Mill',
    description: 'Powers workplaces nearby so they earn more.',
    w: 2,
    h: 2,
    wall: 0xd5bdaf,
    roof: 0x6b705c,
    baseCost: 2_500,
    maxCount: 4,
    maxLevel: 1,
    unlockLevel: 4,
    needsWater: true,
    upgradeCost: () => 0,
    jobs: () => 2,
    millPerWorker: { amount: 0.1, radius: 6 },
  }),
  service({
    id: 'boatyard',
    name: 'Boatyard',
    description: 'Builds boats that take you to new fishing spots. Needs a worker.',
    w: 4,
    h: 4,
    wall: 0xb08968,
    roof: 0x495057,
    baseCost: 15_000,
    maxCount: 1,
    maxLevel: 1,
    unlockLevel: 5,
    needsWater: true,
    upgradeCost: () => 0,
  }),
  service({
    id: 'bathhouse',
    name: 'Bathhouse',
    description: 'Steam, hot baths and a cold dip. Cheers up homes nearby.',
    w: 2,
    h: 4,
    wall: 0xccd5ae,
    roof: 0x7f4f24,
    baseCost: 12_000,
    costGrowth: 1.5,
    maxCount: 2,
    maxLevel: 3,
    unlockLevel: 5,
    needsWater: true,
    upgradeCost: (l) => Math.round(10_000 * Math.pow(2, l - 1)),
    moodPerWorker: { amount: (l) => 4 + l, radius: 6 },
  }),
);

BUILDINGS.push(
  {
    id: 'road',
    name: 'Road',
    description: 'Happier homes, busier shops.',
    category: 'tile',
    w: 1,
    h: 1,
    wall: 0,
    roof: 0,
    baseCost: 3,
    costGrowth: 1,
    maxCount: 2000,
    maxLevel: 1,
    upgradeCost: () => 0,
    refund: 1,
  },
  {
    id: 'canal',
    name: 'Canal',
    description: 'Brings the sea into town.',
    category: 'tile',
    w: 1,
    h: 1,
    wall: 0,
    roof: 0,
    baseCost: 10,
    costGrowth: 1,
    maxCount: 2000,
    maxLevel: 1,
    upgradeCost: () => 0,
    refund: 1,
  },
  {
    id: 'bridge',
    name: 'Bridge',
    description: 'Lets villagers cross a canal.',
    category: 'tile',
    w: 1,
    h: 1,
    wall: 0,
    roof: 0,
    baseCost: 25,
    costGrowth: 1,
    maxCount: 500,
    maxLevel: 1,
    upgradeCost: () => 0,
    refund: 1,
  },
  { ...decor('mooredBoats', 'Moored Boats', 'A rowboat tied up by the bank.', 60, 6, 2, 1, 2), needsWater: true },
  decor('flowerBed', 'Flower Bed', 'A splash of colour.', 15, 6, 2),
  decor('tree', 'Tree', 'Shade and birdsong.', 25, 5, 3),
  decor('bench', 'Bench', 'A spot to sit and chat.', 30, 8, 2, 1, 2),
  decor('lampPost', 'Lamp Post', 'Cosy light for evening walks.', 40, 6, 3, 1, 3),
  decor('fountain', 'Fountain', 'The pride of the town square.', 250, 15, 4, 2, 4),
  // Trophies: one per legendary fish, unlocked by catching it.
  ...(
    [
      ['trophyOldBarnacle', 'oldBarnacle'],
      ['trophySilverKing', 'silverKing'],
      ['trophyCoralEmperor', 'coralEmperor'],
      ['trophyLanternKing', 'lanternKing'],
      ['trophyFrostfin', 'frostfin'],
    ] as [BuildingId, string][]
  ).map(([id, fish]): BuildingDef => {
    const name = FISH.find((f) => f.id === fish)!.name;
    return { ...decor(id, `${name} Trophy`, `Your legendary catch, mounted for all to see.`, 1_000, 12, 4, 2), maxCount: 1, trophy: fish, menuTab: 'special' };
  }),
);

// Landmarks: one of each, very expensive, with a bonus for the whole town and a perk point.
const landmark = (
  id: BuildingId,
  name: string,
  description: string,
  cost: number,
  unlockLevel: number,
  size: [number, number],
  effect: LandmarkEffect,
): BuildingDef => ({
  ...decor(id, name, description, cost, 15, 6, 2, unlockLevel),
  w: size[0],
  h: size[1],
  maxCount: 1,
  refund: 0.5,
  menuTab: 'special',
  landmark: effect,
});

BUILDINGS.push(
  landmark('statue', 'Fisher Statue', 'Honours the town founder. Fish sell for +10%.', 100_000, 7, [2, 2], { fishPrice: 0.1 }),
  landmark('clockTower', 'Clock Tower', 'Keeps the town on time. +10% town income.', 300_000, 8, [2, 2], { income: 0.1 }),
  landmark('grandLighthouse', 'Grand Lighthouse', 'Legendary fish show up 10% more often.', 800_000, 9, [2, 4], { legendaryChance: 0.1 }),
  landmark('harborGate', 'Harbor Gate', 'A grand welcome. +8 happiness in every home.', 2_000_000, 10, [4, 2], { happiness: 8 }),
);

BUILDINGS.push({
  id: 'cannery',
  name: 'Cannery',
  description: 'Cans spare fish from the Icehouse. Cans are worth 3× the fish.',
  category: 'work',
  w: 4,
  h: 4,
  wall: 0xadb5bd,
  roof: 0x6c757d,
  baseCost: 120_000,
  costGrowth: 1,
  maxCount: 1,
  maxLevel: 3,
  unlockLevel: 7,
  upgradeCost: (l) => Math.round(150_000 * Math.pow(2, l - 1)),
  jobs: (l) => 3 + l,
  cansPerWorker: (l) => 0.5 + 0.25 * l,
});

BUILDINGS.push({
  id: 'exportDocks',
  name: 'Export Docks',
  description: 'Trade ships call here and buy your canned fish.',
  category: 'work',
  w: 4,
  h: 4,
  wall: 0x8d6e63,
  roof: 0x264653,
  baseCost: 350_000,
  costGrowth: 1,
  maxCount: 1,
  maxLevel: 3,
  unlockLevel: 8,
  needsWater: true,
  upgradeCost: (l) => Math.round(400_000 * Math.pow(2, l - 1)),
  jobs: () => 4,
  shipCansPerWorker: (l) => 10 + 5 * l,
});

BUILDINGS.push({
  id: 'icehouse',
  name: 'Icehouse',
  description: 'Keeps fish on ice for orders and upgrades.',
  category: 'work',
  menuTab: 'services',
  w: 2,
  h: 2,
  wall: 0xe9f5fb,
  roof: 0x8ecae6,
  baseCost: 800,
  costGrowth: 1,
  maxCount: 1,
  maxLevel: 3,
  unlockLevel: 3,
  upgradeCost: (l) => Math.round(2_000 * Math.pow(2.5, l - 1)),
  crateCapacity: (l) => [0, 40, 90, 160][l] ?? 160,
});

BUILDINGS.push({
  id: 'aquarium',
  name: 'Aquarium',
  description: 'Visitors pay to see every species in your logbook.',
  category: 'work',
  w: 4,
  h: 2,
  wall: 0xe0fbfc,
  roof: 0x3d5a80,
  baseCost: 2_500,
  costGrowth: 1,
  maxCount: 1,
  maxLevel: 3,
  unlockLevel: 3,
  upgradeCost: (l) => Math.round(4_000 * Math.pow(2.5, l - 1)),
  jobs: (l) => 1 + l,
  speciesIncomePerWorker: (l) => 0.5 * Math.pow(1.25, l - 1),
});

// --------------------------------------------------------------- Canning & trade

export const TRADE = {
  /** A can is worth this many times the fish it was made from. */
  canValue: 3,
  /** Cans that fit in storage before the Cannery stops. */
  maxCans: 300,
  /** Seconds between trade ships at the Export Docks. */
  shipEverySeconds: 600,
};

// -------------------------------------------------------------------- Perks
// Permanent upgrades, bought with perk points earned from milestones (never by resetting).

export type PerkId =
  | 'sharpHooks'
  | 'quickReel'
  | 'bigBucket'
  | 'steadyHands'
  | 'luckyCharm'
  | 'shopkeeping'
  | 'welcoming'
  | 'cheerful'
  | 'longNap'
  | 'prosperity'
  | 'coldStorage'
  | 'haggler'
  | 'busyDocks'
  | 'exportDeals'
  | 'bigContracts';
export type PerkBranch = 'fishing' | 'town' | 'trade';

export interface PerkDef {
  id: PerkId;
  name: string;
  branch: PerkBranch;
  /** Tier 2 needs 2 points spent in the branch, tier 3 needs 4. */
  tier: 1 | 2 | 3;
  maxRank: number;
  /** Effect at a rank, e.g. "+10% fish price". */
  describe: (rank: number) => string;
  /** Size of the effect per rank. */
  perRank: number;
}

export const PERKS: PerkDef[] = [
  { id: 'sharpHooks', name: 'Sharp Hooks', branch: 'fishing', tier: 1, maxRank: 3, perRank: 0.05, describe: (r) => `Fish sell for +${r * 5}%` },
  { id: 'quickReel', name: 'Quick Reel', branch: 'fishing', tier: 1, maxRank: 3, perRank: 0.1, describe: (r) => `Line moves ${r * 10}% faster` },
  { id: 'bigBucket', name: 'Big Bucket', branch: 'fishing', tier: 2, maxRank: 2, perRank: 1, describe: (r) => `Hook carries +${r} fish` },
  { id: 'steadyHands', name: 'Steady Hands', branch: 'fishing', tier: 2, maxRank: 2, perRank: 1, describe: (r) => `Dodge ${r} more hit${r === 1 ? '' : 's'} per cast` },
  { id: 'luckyCharm', name: 'Lucky Charm', branch: 'fishing', tier: 3, maxRank: 2, perRank: 0.1, describe: (r) => `Legendaries show up +${r * 10}% more` },
  { id: 'shopkeeping', name: 'Shopkeeping', branch: 'town', tier: 1, maxRank: 3, perRank: 0.05, describe: (r) => `Town income +${r * 5}%` },
  { id: 'welcoming', name: 'Welcoming', branch: 'town', tier: 1, maxRank: 2, perRank: 0.25, describe: (r) => `Residents move in ${r * 25}% faster` },
  { id: 'cheerful', name: 'Cheerful', branch: 'town', tier: 2, maxRank: 2, perRank: 3, describe: (r) => `+${r * 3} happiness in every home` },
  { id: 'longNap', name: 'Long Nap', branch: 'town', tier: 2, maxRank: 2, perRank: 2, describe: (r) => `Earn ${r * 2}h longer while away` },
  { id: 'prosperity', name: 'Prosperity', branch: 'town', tier: 3, maxRank: 1, perRank: 0.1, describe: () => 'Town income +10% more' },
  { id: 'coldStorage', name: 'Cold Storage', branch: 'trade', tier: 1, maxRank: 3, perRank: 0.25, describe: (r) => `Icehouse holds +${r * 25}%` },
  { id: 'haggler', name: 'Haggler', branch: 'trade', tier: 1, maxRank: 3, perRank: 0.1, describe: (r) => `Orders pay +${r * 10}%` },
  { id: 'busyDocks', name: 'Busy Docks', branch: 'trade', tier: 2, maxRank: 2, perRank: 0.25, describe: (r) => `Orders and ships come ${r * 25}% sooner` },
  { id: 'exportDeals', name: 'Export Deals', branch: 'trade', tier: 2, maxRank: 2, perRank: 0.15, describe: (r) => `Ships pay +${r * 15}% for cans` },
  { id: 'bigContracts', name: 'Big Contracts', branch: 'trade', tier: 3, maxRank: 1, perRank: 1, describe: () => '+1 open order at a time' },
];

export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p])) as Record<PerkId, PerkDef>;
/** Points spent in a branch before its tier 2 / tier 3 perks open up. */
export const PERK_TIER_POINTS = [0, 0, 2, 4];
/** A perk point for every this many species in the logbook. */
export const SPECIES_PER_PERK_POINT = 10;

// ------------------------------------------------------------------- Orders
// Staffed shops ask for fish from the Icehouse. Each delivery makes that building earn more, for good.

export const ORDERS = {
  /** Town level that starts orders (same as the Icehouse). */
  unlockLevel: 3,
  /** Orders open at once. */
  max: 3,
  /** Seconds between new orders. */
  everySeconds: 300,
  /** Income boost per delivery for the building that ordered, and its cap. */
  boostPerDelivery: 0.05,
  maxBoost: 0.5,
  /** Coins paid on delivery, as a multiple of the fish's sale value. */
  payMultiplier: 1.5,
};

/**
 * Upgrading a building to Lv 3 (or more) also takes fish from the Icehouse. Which fish depends on
 * the town level that unlocks the building, so later buildings ask for rarer fish.
 */
export const UPGRADE_FISH: Record<number, string> = { 1: 'cod', 2: 'cod', 3: 'salmon', 4: 'salmon', 5: 'tuna', 6: 'angler' };
export const upgradeFishAmount = (toLevel: number) => 4 + 4 * (toLevel - 2);

// ------------------------------------------------------------------- Quests

export const QUESTS = {
  /** Town level that unlocks the quest board. */
  unlockLevel: 2,
  /** Quests on the board at once. */
  active: 3,
  /** Swapping a quest costs this × town level. */
  swapCostPerLevel: 25,
  /** Chance a reward also includes a pack of the best bait you can buy. */
  baitRewardChance: 0.3,
};

// ------------------------------------------------------------- Player house
// Your own home by the dock. Its level is the town level: it gates which buildings unlock,
// and each level makes fish sell for a bit more.

export interface TownLevel {
  /** Coins to upgrade the house to this level (unused for level 1). */
  cost: number;
  /** Residents the town needs before upgrading to this level. */
  residents: number;
  /** Fish from the Icehouse the upgrade also needs. */
  fish?: FishNeed;
}

/** Some fish of one kind, e.g. 10 Salmon. */
export interface FishNeed {
  fish: string;
  amount: number;
}

/** Index = level; index 0 is unused so TOWN_LEVELS[level] reads naturally. */
export const TOWN_LEVELS: TownLevel[] = [
  { cost: 0, residents: 0 },
  { cost: 0, residents: 0 },
  { cost: 300, residents: 2 },
  { cost: 1_500, residents: 6 },
  { cost: 6_000, residents: 12, fish: { fish: 'salmon', amount: 10 } },
  { cost: 20_000, residents: 24, fish: { fish: 'tuna', amount: 8 } },
  { cost: 60_000, residents: 40, fish: { fish: 'angler', amount: 5 } },
  // Late game: each level needs fish from a boat area.
  { cost: 150_000, residents: 50, fish: { fish: 'swordfish', amount: 8 } },
  { cost: 400_000, residents: 60, fish: { fish: 'grouper', amount: 6 } },
  { cost: 1_000_000, residents: 70, fish: { fish: 'giantSquid', amount: 4 } },
  { cost: 2_500_000, residents: 80, fish: { fish: 'wolffish', amount: 3 } },
];
export const MAX_TOWN_LEVEL = TOWN_LEVELS.length - 1;

/** Extra fish sale price per house level above 1. */
export const FISH_PRICE_BONUS_PER_LEVEL = 0.1;

/** Where a new game puts your house: just above the dock. */
export const PLAYER_HOUSE_SPOT = { col: 5, row: 0 };

BUILDINGS.unshift({
  id: 'playerHouse',
  name: 'Your House',
  description: 'Home sweet home. Upgrade it to unlock new buildings.',
  category: 'player',
  w: 4,
  h: 4,
  wall: 0xfaf3e0,
  roof: 0xc1121f,
  baseCost: 0,
  costGrowth: 1,
  maxCount: 1,
  maxLevel: MAX_TOWN_LEVEL,
  upgradeCost: (l) => TOWN_LEVELS[l + 1]?.cost ?? 0,
});

export const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
