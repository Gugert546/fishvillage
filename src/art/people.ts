// Pixel villagers: 7×11 art px, two walking frames, colours stable per resident.

import Phaser from 'phaser';
import { PAL, pixTexture } from '../pixel';
import { Art } from './kit';

const SHIRTS = [PAL.red, PAL.sky, PAL.amber, PAL.green, PAL.magenta, PAL.ocean, PAL.orange, PAL.crimson, PAL.plum, PAL.lime];
const SKIN = [PAL.skin, PAL.tan, PAL.skinDark, PAL.clay, PAL.brown];
const HAIR = [PAL.bark, PAL.brown, PAL.amber, PAL.ink, PAL.copper, PAL.cloud];
const PANTS = [PAL.navy, PAL.slate, PAL.brown, PAL.ocean];

export interface Look {
  shirt: number;
  skin: number;
  hair: number;
  pants: number;
  /** A cap instead of hair on top (the player's red cap). */
  cap?: number;
}

export function lookFor(id: number): Look {
  return {
    shirt: SHIRTS[id % SHIRTS.length],
    skin: SKIN[(id * 7) % SKIN.length],
    hair: HAIR[(id * 3) % HAIR.length],
    pants: PANTS[(id * 5) % PANTS.length],
  };
}

export const PLAYER_LOOK: Look = { shirt: PAL.amber, skin: PAL.skin, hair: PAL.brown, pants: PAL.navy, cap: PAL.red };

/**
 * Texture key for a person; feet at the bottom middle. Frame 0 stands, frame 1 is mid-stride.
 * The image is 18×26 world px; use origin (0.5, 1).
 */
export function personTexture(scene: Phaser.Scene, look: Look, frame: 0 | 1 = 0): string {
  const key = `person-${look.shirt}-${look.skin}-${look.hair}-${look.pants}-${look.cap ?? 0}-${frame}`;
  return pixTexture(scene, key, 0, 0, 14, 22, (p) => {
    const a = new Art(p);
    const top = look.cap ?? look.hair;
    // Head
    a.r(1, 0, 5, 1, top).r(0, 1, 7, 1, top);
    if (look.cap) a.r(5, 1, 3, 1, look.cap);
    a.d(0, 2, look.hair).r(1, 2, 5, 2, look.skin).d(6, 2, look.hair);
    a.d(2, 2, PAL.ink).d(4, 2, PAL.ink);
    // Body and arms
    a.r(1, 4, 5, 3, look.shirt).d(0, 5, look.shirt).d(6, 5, look.shirt);
    a.d(0, 6, look.skin).d(6, 6, look.skin);
    // Legs
    if (frame === 0) {
      a.r(1, 7, 2, 3, look.pants).r(4, 7, 2, 3, look.pants);
      a.r(1, 10, 2, 1, PAL.bark).r(4, 10, 2, 1, PAL.bark);
    } else {
      a.r(1, 7, 5, 1, look.pants).r(0, 8, 2, 2, look.pants).r(5, 8, 2, 2, look.pants);
      a.r(0, 10, 2, 1, PAL.bark).r(5, 10, 2, 1, PAL.bark);
    }
    a.outline();
  }, { pad: 1 }).key;
}

/** Ground shadow under a person, centred on (0, 0). */
export function personShadowTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'person-shadow', -6, -2, 12, 4, (p) => {
    p.fillStyle(PAL.ink, 0.25).fillEllipse(0, 0, 12, 4);
  }, { pad: 0 }).key;
}
