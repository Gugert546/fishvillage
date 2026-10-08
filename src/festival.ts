// Festivals at the Town Square: pay up front for a while of livelier, richer town life.

import { FESTIVAL } from './config';
import { totalIncome } from './happiness';
import { save, state } from './state';

export const festivalActive = (now = Date.now()): boolean => !!state.festival && state.festival.until > now;

/** A festival's bonus, or 0 when none is on. */
export const festivalBonus = (amount: number): number => (festivalActive() ? amount : 0);

export function festivalMinutesLeft(now = Date.now()): number {
  return festivalActive(now) ? Math.ceil((state.festival!.until - now) / 60_000) : 0;
}

/** About ten minutes of the town's income, with a floor for small towns. */
export function festivalCost(): number {
  const perMinute = totalIncome() / (1 + festivalBonus(FESTIVAL.income));
  return Math.max(FESTIVAL.minCost, Math.round((perMinute * FESTIVAL.costMinutes) / 50) * 50);
}

export function hostFestival(squareLevel: number): boolean {
  const cost = festivalCost();
  if (festivalActive() || state.coins < cost) return false;
  state.coins -= cost;
  const name = FESTIVAL.names[Math.floor(Math.random() * FESTIVAL.names.length)];
  state.festival = { until: Date.now() + FESTIVAL.minutes(squareLevel) * 60_000, name };
  save();
  return true;
}
