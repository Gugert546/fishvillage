// The traveling merchant: calls on a schedule with a few luxuries, different every visit.

import { MERCHANT, MERCHANT_ITEMS, type CharmId, type MerchantItem, type MerchantItemId } from './config';
import { queueToast } from './quests';
import { save, state } from './state';
import { townLevel } from './town';
import { canAfford, spend } from './dev';

const periodMs = MERCHANT.everyMinutes * 60_000;
const slotOf = (now: number) => Math.floor(now / periodMs);

export const merchantUnlocked = (): boolean => townLevel() >= MERCHANT.unlockLevel;

/** True while the merchant's boat is tied up at the pier. */
export function merchantHere(now = Date.now()): boolean {
  return merchantUnlocked() && now % periodMs < MERCHANT.staysMinutes * 60_000;
}

/** Minutes until the merchant leaves (if here) or arrives (if not). */
export function merchantMinutes(now = Date.now()): number {
  const into = now % periodMs;
  const stay = MERCHANT.staysMinutes * 60_000;
  return Math.ceil((into < stay ? stay - into : periodMs - into) / 60_000);
}

const bought = (id: MerchantItemId) => state.merchantBought[id] ?? 0;

/** This visit's goods: the same for the whole visit, different next time. */
export function merchantStock(now = Date.now()): MerchantItem[] {
  const slot = slotOf(now);
  const pool = MERCHANT_ITEMS.filter((i) => !i.limit || bought(i.id) < i.limit);
  const picked: MerchantItem[] = [];
  let seed = (slot * 2654435761) >>> 0;
  while (picked.length < Math.min(MERCHANT.stock, pool.length)) {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    const item = pool[seed % pool.length];
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

export const itemPrice = (item: MerchantItem): number => item.price(townLevel(), bought(item.id));

/** Already bought on this visit (one of each per visit). */
export function boughtThisVisit(item: MerchantItem, now = Date.now()): boolean {
  return state.merchantVisit.slot === slotOf(now) && state.merchantVisit.bought.includes(item.id);
}

export function buyItem(item: MerchantItem, now = Date.now()): boolean {
  const price = itemPrice(item);
  if (!merchantHere(now) || boughtThisVisit(item, now) || !canAfford(price)) return false;
  if (item.limit && bought(item.id) >= item.limit) return false;
  spend(price);
  state.merchantBought[item.id] = bought(item.id) + 1;
  if (state.merchantVisit.slot !== slotOf(now)) state.merchantVisit = { slot: slotOf(now), bought: [] };
  state.merchantVisit.bought.push(item.id);
  if (item.charges) {
    const charm = item.id as CharmId;
    state.charms[charm] = (state.charms[charm] ?? 0) + item.charges;
  }
  save();
  return true;
}

/** Spends one cast of a charm; returns whether it was active. */
export function useCharm(id: CharmId): boolean {
  const left = state.charms[id] ?? 0;
  if (left <= 0) return false;
  state.charms[id] = left - 1;
  return true;
}

/** Announces the merchant's arrival once per visit (called once a second). */
export function checkMerchant(now = Date.now()): void {
  if (!merchantHere(now) || state.merchantSeen === slotOf(now)) return;
  state.merchantSeen = slotOf(now);
  queueToast(`The merchant is in port for ${merchantMinutes(now)} min!`);
}

/** Ancient Charts bought: each is a perk point. */
export const chartPoints = (): number => bought('ancientChart');
