// Fish crates: catches kept on ice in the Icehouse, spent on orders from shops and on upgrades.

import {
  AREA_BY_ID,
  BUILDING_BY_ID,
  FISH,
  ORDERS,
  STORAGE,
  TOWN_LEVELS,
  UPGRADE_FISH,
  upgradeFishAmount,
  type FishNeed,
  type FishType,
} from './config';
import { defOf, workerCounts } from './population';
import { queueToast } from './quests';
import { fishingStats, save, state, type Order, type PlacedBuilding } from './state';
import { ownsArea, townLevel } from './town';
import { isWorking, wateredTiles } from './water';
import { perkBonus } from './perks';
import { projectDone } from './projects';

const fishById = (id: string): FishType => FISH.find((f) => f.id === id)!;
export const fishName = (id: string): string => fishById(id).name;

// ------------------------------------------------------------------ Crates

/** How many fish you can keep: the dock barrels plus the Icehouse. */
export function crateCapacity(): number {
  const house = state.buildings.find((b) => b.type === 'icehouse');
  const ice = house ? (BUILDING_BY_ID.icehouse.crateCapacity?.(house.level) ?? 0) : 0;
  return Math.floor((STORAGE.barrels + ice) * (1 + perkBonus('coldStorage')));
}

export function cratesUsed(): number {
  return Object.values(state.crates).reduce((sum, n) => sum + n, 0);
}

export const crateSpace = (): number => Math.max(0, crateCapacity() - cratesUsed());
export const onIce = (fish: string): number => state.crates[fish] ?? 0;

/** Puts up to `n` fish on ice; returns how many fitted. */
export function storeFish(fish: string, n: number): number {
  const fit = Math.min(n, crateSpace());
  if (fit > 0) state.crates[fish] = onIce(fish) + fit;
  return fit;
}

/** Takes fish back off the ice (e.g. to sell them after all). */
export function unstoreFish(fish: string, n: number): number {
  const out = Math.min(n, onIce(fish));
  state.crates[fish] = onIce(fish) - out;
  if (state.crates[fish] === 0) delete state.crates[fish];
  return out;
}

export const hasFish = (need: FishNeed): boolean => onIce(need.fish) >= need.amount;

function useFish(need: FishNeed): boolean {
  if (!hasFish(need)) return false;
  unstoreFish(need.fish, need.amount);
  return true;
}

// ---------------------------------------------------------------- Upgrades

/** Fish the next level of this building needs (house levels 4+, other buildings Lv 3+). */
export function upgradeNeed(b: PlacedBuilding): FishNeed | undefined {
  const to = b.level + 1;
  if (b.type === 'playerHouse') return TOWN_LEVELS[to]?.fish;
  const def = defOf(b);
  if (to < 3 || to > def.maxLevel || def.category === 'decor' || def.category === 'tile') return undefined;
  return { fish: UPGRADE_FISH[def.unlockLevel ?? 1] ?? 'cod', amount: upgradeFishAmount(to) };
}

/** Takes the fish an upgrade needs; false (and nothing taken) if there aren't enough. */
export function payUpgradeFish(b: PlacedBuilding): boolean {
  const need = upgradeNeed(b);
  return !need || useFish(need);
}

// ------------------------------------------------------------------ Orders

export const ordersUnlocked = (): boolean => townLevel() >= ORDERS.unlockLevel;

/** Extra income a building earns from orders delivered to it (0.1 = +10%). */
export function deliveryBoost(b: PlacedBuilding): number {
  return Math.min(ORDERS.maxBoost, (b.deliveries ?? 0) * ORDERS.boostPerDelivery);
}

/** Big asks for cheap fish, small ones for pricey fish. */
const orderAmount = (f: FishType) => (f.value <= 6 ? 12 : f.value <= 15 ? 8 : f.value <= 40 ? 6 : f.value <= 150 ? 4 : 3);

function newOrder(): Order | undefined {
  const counts = workerCounts();
  const wet = wateredTiles();
  const taken = new Set(state.orders.map((o) => o.building));
  const shops = state.buildings.filter((b) => {
    const def = defOf(b);
    return (def.incomePerWorker || def.speciesIncomePerWorker) && (counts.get(b.id) ?? 0) > 0 && isWorking(b, wet) && !taken.has(b.id);
  });
  const line = fishingStats().lineLength;
  const fish = FISH.filter((f) => !f.legendary && ownsArea(AREA_BY_ID[f.area]) && f.minDepth + 5 <= line + AREA_BY_ID[f.area].lineBonus);
  if (shops.length === 0 || fish.length === 0) return undefined;
  const b = shops[Math.floor(Math.random() * shops.length)];
  const f = fish[Math.floor(Math.random() * fish.length)];
  const amount = orderAmount(f);
  return { id: state.nextOrderId++, building: b.id, fish: f.id, amount, coins: Math.round(f.value * amount * ORDERS.payMultiplier * (1 + perkBonus('haggler') + (projectDone('tradeOffice') ? 0.2 : 0))) };
}

/** Drops orders from buildings that are gone, and posts new ones over time. */
export function tickOrders(seconds: number): void {
  const ids = new Set(state.buildings.map((b) => b.id));
  state.orders = state.orders.filter((o) => ids.has(o.building));
  const max = ORDERS.max + perkBonus('bigContracts');
  const every = ORDERS.everySeconds / (1 + perkBonus('busyDocks'));
  if (!ordersUnlocked() || state.orders.length >= max) {
    state.orderTimer = 0;
    return;
  }
  state.orderTimer += seconds;
  while (state.orderTimer >= every && state.orders.length < max) {
    state.orderTimer -= every;
    const order = newOrder();
    if (!order) break;
    state.orders.push(order);
    queueToast(`New order: ${orderTitle(order)}`);
  }
}

export function orderBuilding(o: Order): PlacedBuilding | undefined {
  return state.buildings.find((b) => b.id === o.building);
}

export function orderTitle(o: Order): string {
  const b = orderBuilding(o);
  return `${b ? defOf(b).name : 'Someone'} wants ${o.amount} ${fishName(o.fish)}`;
}

export const canDeliver = (o: Order): boolean => hasFish({ fish: o.fish, amount: o.amount });

export function deliver(o: Order): boolean {
  const b = orderBuilding(o);
  if (!b || !useFish({ fish: o.fish, amount: o.amount })) return false;
  b.deliveries = (b.deliveries ?? 0) + 1;
  state.coins += o.coins;
  state.orders = state.orders.filter((x) => x !== o);
  save();
  return true;
}

/** Throws an order away; a new one comes along later. */
export function dropOrder(o: Order): void {
  state.orders = state.orders.filter((x) => x !== o);
  save();
}

export const readyOrders = (): number => state.orders.filter(canDeliver).length;
