// Festivals at the Town Square: pay up front for a while of livelier, richer town life.

import { FESTIVAL } from './config';
import { totalIncome } from './happiness';
import { save, state } from './state';
import { canAfford, spend } from './dev';

export const festivalActive = (now = Date.now()): boolean => !!state.festival && state.festival.until > now;

/** A festival's bonus, or 0 when none is on. */
export const festivalBonus = (amount: number): number => (festivalActive() ? amount : 0);

export function festivalMinutesLeft(now = Date.now()): number {
  return festivalActive(now) ? Math.ceil((state.festival!.until - now) / 60_000) : 0;
}

/** Notes coins from selling fish, so festivals cost what a fishing-heavy player earns too. */
export function recordFishSale(coins: number, now = Date.now()): void {
  if (coins <= 0) return;
  const since = now - FESTIVAL.fishingWindowMinutes * 60_000;
  state.fishSales = state.fishSales.filter(([t]) => t >= since);
  state.fishSales.push([now, coins]);
}

/** Average coins per minute from fish sales over the last little while. */
export function fishingPerMinute(now = Date.now()): number {
  const since = now - FESTIVAL.fishingWindowMinutes * 60_000;
  const coins = state.fishSales.reduce((sum, [t, c]) => (t >= since ? sum + c : sum), 0);
  return coins / FESTIVAL.fishingWindowMinutes;
}

/** About ten minutes of everything you earn (town and fishing), with a floor for small towns. */
export function festivalCost(): number {
  // Without the festival's own boosts, so the price doesn't climb while one is on.
  const town = totalIncome() / (1 + festivalBonus(FESTIVAL.income));
  const fishing = fishingPerMinute() / (1 + festivalBonus(FESTIVAL.fishPrice));
  const perMinute = town + fishing;
  return Math.max(FESTIVAL.minCost, Math.round((perMinute * FESTIVAL.costMinutes) / 50) * 50);
}

export function hostFestival(squareLevel: number): boolean {
  const cost = festivalCost();
  if (festivalActive() || !canAfford(cost)) return false;
  spend(cost);
  const name = FESTIVAL.names[Math.floor(Math.random() * FESTIVAL.names.length)];
  state.festival = { until: Date.now() + FESTIVAL.minutes(squareLevel) * 60_000, name };
  save();
  return true;
}
