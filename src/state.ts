import { BASE_STATS, UPGRADES, type BuildingId, type FishingStats, type UpgradeId } from './config';

const SAVE_KEY = 'fishvillage.save.v1';

export interface PlacedBuilding {
  id: number;
  type: BuildingId;
  /** Grid position of the bottom-left tile; rows count upward from the dock. */
  col: number;
  row: number;
  level: number;
  /** Coins spent on building + upgrading it, for sell refunds. Missing in old saves. */
  spent?: number;
}

export interface GameState {
  /** Can be fractional while passive income trickles in; display with Math.floor. */
  coins: number;
  upgrades: Record<UpgradeId, number>;
  /** Total caught per fish id, for the future aquarium/collection. */
  caught: Record<string, number>;
  buildings: PlacedBuilding[];
  expansions: number;
  nextBuildingId: number;
  lastSaved: number;
}

function freshState(): GameState {
  return {
    coins: 0,
    upgrades: { line: 0, capacity: 0, shield: 0, reel: 0 },
    caught: {},
    buildings: [],
    expansions: 0,
    nextBuildingId: 1,
    lastSaved: Date.now(),
  };
}

function load(): GameState {
  const state = freshState();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<GameState>;
      // Merge so new fields added later get their defaults.
      Object.assign(state, saved);
      state.upgrades = { ...freshState().upgrades, ...saved.upgrades };
    }
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  return state;
}

export const state: GameState = load();

export function save(): void {
  state.lastSaved = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode etc.); progress lives for this session only.
  }
}

export function fishingStats(): FishingStats {
  const stats = { ...BASE_STATS };
  for (const def of UPGRADES) def.apply(stats, state.upgrades[def.id]);
  return stats;
}
