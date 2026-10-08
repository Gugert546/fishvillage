// Selling fish: today's price for every species, the bonuses that apply at the moment of sale,
// and putting each catch into the barrels.

import { FESTIVAL, FISH, FISH_PRICE_BONUS_PER_LEVEL, STORAGE, WORLD, type FishType } from './config';
import { crateSpace, onIce, storeFish, unstoreFish } from './crates';
import { festivalBonus } from './festival';
import { logbookBonus } from './logbook';
import { useCharm } from './merchant';
import { landmarkBonus, perkBonus } from './perks';
import { projectDone } from './projects';
import { questEvent } from './quests';
import { marketBonus } from './services';
import { save, state } from './state';
import { townLevel } from './town';
import { dayNumber, fishOfTheDay, hash01, weather } from './world';

const fishById = (id: string): FishType => FISH.find((f) => f.id === id)!;

/** Small stable number per fish id, to mix into the daily price. */
const idHash = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Today's price for a species as a multiple of normal (the fish of the day gets +50% on top). */
export function dailyFactor(fishId: string): number {
  const r = hash01((dayNumber() * 1009) ^ idHash(fishId));
  const swing = Math.round((STORAGE.dailyMin + r * (STORAGE.dailyMax - STORAGE.dailyMin)) * 20) / 20;
  return swing + (fishOfTheDay().id === fishId ? WORLD.fishOfTheDayBonus : 0);
}

/** Price bonuses that apply right now, by name (0.1 = +10%). */
export function priceBonuses(type: FishType): [string, number][] {
  const parts: [string, number][] = [
    ['house', FISH_PRICE_BONUS_PER_LEVEL * (townLevel() - 1)],
    ['market', marketBonus()],
    ['perks', perkBonus('sharpHooks') + landmarkBonus('fishPrice')],
    ['storm', weather() === 'storm' ? WORLD.stormPrice : 0],
    ['town', festivalBonus(FESTIVAL.fishPrice) + (projectDone('fishAuction') ? 0.1 : 0)],
    ['logbook', logbookBonus(type.area)],
  ];
  return parts.filter(([, v]) => v > 0);
}

/** What one fish sells for right now. */
export function salePrice(type: FishType): number {
  const bonus = priceBonuses(type).reduce((sum, [, v]) => sum + v, 0);
  return Math.round(type.value * dailyFactor(type.id) * (1 + bonus));
}

export interface CatchResult {
  /** Fish that went into the barrels, per type. */
  kept: Map<FishType, number>;
  /** Fish that didn't fit and were sold on the spot. */
  overflow: Map<FishType, number>;
  overflowCoins: number;
}

/** Puts a cast's catch into the barrels; whatever doesn't fit is sold cheaply right away. */
export function stowCatch(fish: FishType[]): CatchResult {
  const result: CatchResult = { kept: new Map(), overflow: new Map(), overflowCoins: 0 };
  // Pricier fish get the space first.
  for (const type of [...fish].sort((a, b) => b.value - a.value)) {
    if (crateSpace() > 0) {
      storeFish(type.id, 1);
      result.kept.set(type, (result.kept.get(type) ?? 0) + 1);
    } else {
      result.overflow.set(type, (result.overflow.get(type) ?? 0) + 1);
      result.overflowCoins += Math.round(salePrice(type) * STORAGE.overflowPrice);
    }
  }
  state.coins += result.overflowCoins;
  if (result.overflowCoins > 0) questEvent({ type: 'sold', coins: result.overflowCoins });
  save();
  return result;
}

/** Sells fish from the barrels; a Market Voucher (if you have one) adds 50% to the whole sale. */
export function sellFish(entries: [string, number][]): number {
  let coins = 0;
  for (const [id, n] of entries) coins += salePrice(fishById(id)) * unstoreFish(id, n);
  if (coins === 0) return 0;
  if (useCharm('voucher')) coins = Math.round(coins * 1.5);
  state.coins += coins;
  questEvent({ type: 'sold', coins });
  save();
  return coins;
}

/** Everything in the barrels, most valuable first. */
export function stock(): [FishType, number][] {
  return Object.entries(state.crates)
    .filter(([, n]) => n > 0)
    .map(([id, n]): [FishType, number] => [fishById(id), n])
    .sort((a, b) => salePrice(b[0]) - salePrice(a[0]));
}

export const stockValue = (): number => stock().reduce((sum, [type, n]) => sum + salePrice(type) * n, 0);
export const sellAll = (): number => sellFish(stock().map(([type, n]) => [type.id, n]));
export const sellType = (type: FishType): number => sellFish([[type.id, onIce(type.id)]]);
