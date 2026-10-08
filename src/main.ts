import Phaser from 'phaser';
import '@fontsource/tiny5/400.css';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { FishingScene } from './scenes/FishingScene';
import { TownScene } from './scenes/TownScene';
import { save, state } from './state';
import { ensurePlayerHouse, grantStarterResidents } from './town';
import { unlockAudio } from './sound';
import { FONT } from './ui';

// House first, so starter cottages for old saves can't take its spot by the dock.
ensurePlayerHouse();
grantStarterResidents();

// New players start on the dock; once they've built something of their own, open in town.
const hasBuilt = state.buildings.some((b) => b.type !== 'playerHouse');
const scenes = hasBuilt ? [TownScene, FishingScene] : [FishingScene, TownScene];

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#124e89',
  // Crisp pixels everywhere: nearest-neighbour textures and a canvas scaled up without blur.
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
  },
  scene: scenes,
};

let game: Phaser.Game | undefined;
const start = () => {
  game ??= new Phaser.Game(config);
  // Dev-only console handle, e.g. `fv.state.coins = 5000`.
  if (import.meta.env.DEV) Object.assign(window, { fv: { game, state, save } });
};
// Text is measured when it's created, so wait for the pixel font (but never forever).
Promise.race([
  document.fonts.load(`16px ${FONT}`),
  new Promise((r) => setTimeout(r, 2000)),
]).then(start, start);

// Audio may only start from a tap (iOS); every tap also wakes it after the app was backgrounded.
window.addEventListener('pointerdown', unlockAudio);
