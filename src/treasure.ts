// What you fish up besides fish: treasure chests, messages in bottles and the odd old boot.

import { AREAS, BAITS, FISH, TREASURE, type AreaDef, type CharmId, type ItemId } from './config';
import { save, state } from './state';
import { baitUnlocked, ownsArea, townLevel } from './town';

export interface ItemReward {
  item: ItemId;
  /** One line for the catch screen. */
  text: string;
  coins: number;
}

/** Opens one item and hands out what's inside. */
export function openItem(item: ItemId, area: AreaDef): ItemReward {
  if (item === 'chest') return openChest(area);
  if (item === 'bottle') return readBottle();
  const coins = 1;
  state.coins += coins;
  return { item, text: item === 'boot' ? 'An old boot. Someone lost a shoe!' : 'A rusty can. Recycled for $1', coins };
}

function openChest(area: AreaDef): ItemReward {
  const areaNo = AREAS.indexOf(area) + 1;
  const coins = Math.round(TREASURE.chestCoins * townLevel() * areaNo * (0.7 + Math.random() * 0.6));
  state.coins += coins;
  const extras: string[] = [];
  const bait = [...BAITS].reverse().find(baitUnlocked);
  if (bait && Math.random() < TREASURE.chestBaitChance) {
    state.bait[bait.id] = (state.bait[bait.id] ?? 0) + 3;
    extras.push(`3 ${bait.name}`);
  }
  if (Math.random() < TREASURE.chestCharmChance) {
    const charm: CharmId = Math.random() < 0.5 ? 'goldenNet' : 'voucher';
    state.charms[charm] = (state.charms[charm] ?? 0) + (charm === 'goldenNet' ? 3 : 1);
    extras.push(charm === 'goldenNet' ? 'a Golden Net' : 'a Market Voucher');
  }
  save();
  return { item: 'chest', text: `Treasure! $${coins}${extras.length ? ` + ${extras.join(' + ')}` : ''}`, coins };
}

/** A note about where a legendary was seen: it'll be waiting on your next cast there. */
function readBottle(): ItemReward {
  const options = AREAS.filter((a) => ownsArea(a) && !state.legendHints.includes(a.id) && FISH.some((f) => f.area === a.id && f.legendary));
  const area = options[Math.floor(Math.random() * options.length)];
  if (!area) {
    const coins = 25 * townLevel();
    state.coins += coins;
    return { item: 'bottle', text: `A faded note and a few coins: $${coins}`, coins };
  }
  state.legendHints.push(area.id);
  save();
  const legend = FISH.find((f) => f.area === area.id && f.legendary)!;
  return { item: 'bottle', text: `"${legend.name} spotted in the ${area.name}!" It's there next cast`, coins: 0 };
}

/** Uses up a bottle's hint once its legendary is in the water. */
export function useLegendHint(area: AreaDef['id']): boolean {
  const i = state.legendHints.indexOf(area);
  if (i < 0) return false;
  state.legendHints.splice(i, 1);
  return true;
}
