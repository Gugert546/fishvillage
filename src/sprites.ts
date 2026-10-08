// Your own hand-drawn sprites. Any PNG in assets/sprites/ is picked up automatically and named
// after its file (assets/sprites/road.png → "road"). Code asks `hasSprite("road")` and falls back
// to the built-in pixel art when the file isn't there, so sprites can be replaced one at a time.

import Phaser from 'phaser';

/** Art is drawn at 16px per tile and shown at 2x. */
export const ART_SCALE = 2;

// Vite lists the folder at build time; adding a file in dev reloads the page with it.
const files = import.meta.glob('/assets/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  URLS[path.slice(path.lastIndexOf('/') + 1, -'.png'.length)] = url;
}

const textureKey = (name: string) => `sprite:${name}`;

/** Queue every sprite for loading; call from a scene's preload(). Already-loaded ones are skipped. */
export function preloadSprites(scene: Phaser.Scene): void {
  const pending = Object.keys(URLS).filter((name) => !scene.textures.exists(textureKey(name)));
  for (const name of pending) scene.load.image(textureKey(name), URLS[name]);
  if (pending.length === 0) return;
  // Crisp pixels: no smoothing when the art is scaled up.
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    for (const name of pending) {
      if (scene.textures.exists(textureKey(name))) {
        scene.textures.get(textureKey(name)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
  });
}

export function hasSprite(scene: Phaser.Scene, name: string): boolean {
  return scene.textures.exists(textureKey(name));
}

/** A sprite image with its top-left corner at (x, y), scaled up to game size. */
export function addSprite(scene: Phaser.Scene, name: string, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, textureKey(name)).setOrigin(0, 0).setScale(ART_SCALE);
}
