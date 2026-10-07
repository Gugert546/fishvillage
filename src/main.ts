import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { FishingScene } from './scenes/FishingScene';
import { TownScene } from './scenes/TownScene';
import { save, state } from './state';
import { grantStarterResidents } from './town';

grantStarterResidents();

// New players start on the dock; once they've built something, open in town.
const scenes = state.buildings.length > 0 ? [TownScene, FishingScene] : [FishingScene, TownScene];

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0d2e5c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
  },
  scene: scenes,
});

// Dev-only console handle, e.g. `fv.state.coins = 5000`.
if (import.meta.env.DEV) Object.assign(window, { fv: { game, state, save } });
