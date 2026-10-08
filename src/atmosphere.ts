// Night tint, rain, lightning and the little weather badge, shared by the town and the dock.

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, WORLD } from './config';
import { sfx } from './sound';
import { COLORS, UI_DEPTH, fixToScreen, makeText, onTap, showToast } from './ui';
import { projectDone } from './projects';
import { stormBound } from './town';
import { darkness, fishOfTheDay, isNight, minutesToDayChange, minutesToWeatherChange, weather, WEATHER_NAMES, type Weather } from './world';

/** Above the world, below the HUD. */
export const ATMOSPHERE_DEPTH = UI_DEPTH - 10;

interface Drop {
  x: number;
  y: number;
  speed: number;
}

function weatherTip(w: Weather): string {
  if (w === 'clear') return 'Clear skies';
  if (w === 'cloudy') return 'Cloudy';
  if (w === 'rain') return `Rain: ${Math.round(((projectDone('weatherStation') ? WORLD.rainFishStation : WORLD.rainFish) - 1) * 100)}% more fish bite`;
  return `Storm: ${stormBound() ? 'boats stay in port, ' : ''}fish sell +${WORLD.stormPrice * 100}%`;
}

export class Atmosphere {
  private tint: Phaser.GameObjects.Rectangle;
  private flash: Phaser.GameObjects.Rectangle;
  private rain: Phaser.GameObjects.Graphics;
  private drops: Drop[] = [];
  private badgeIcon: Phaser.GameObjects.Graphics;
  private badgeText: Phaser.GameObjects.Text;
  private shown = '';
  private nextBolt = 0;
  private lastCheck = 0;
  private current: Weather = 'clear';
  private dark = 0;

  constructor(private scene: Phaser.Scene) {
    // Multiply darkens the scene toward deep blue without washing out colours.
    this.tint = fixToScreen(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff).setOrigin(0))
      .setDepth(ATMOSPHERE_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.rain = fixToScreen(scene.add.graphics()).setDepth(ATMOSPHERE_DEPTH + 1);
    this.flash = fixToScreen(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0).setOrigin(0)).setDepth(ATMOSPHERE_DEPTH + 2);

    const bx = GAME_WIDTH - 76;
    const by = 68;
    const bg = scene.add.rectangle(0, 0, 136, 28, 0x0b2545, 0.75).setStrokeStyle(1, 0xffffff, 0.3);
    this.badgeIcon = scene.add.graphics();
    this.badgeText = makeText(scene, -40, 0, '', 13).setOrigin(0, 0.5);
    const badge = fixToScreen(scene.add.container(bx, by, [bg, this.badgeIcon, this.badgeText])).setDepth(UI_DEPTH);
    badge.setSize(136, 28);
    onTap(badge, () => {
      const w = weather();
      const light = isNight() ? `Night: rare fish bite more · day in ${minutesToDayChange()} min` : `Day · night in ${minutesToDayChange()} min`;
      showToast(scene, `${weatherTip(w)} (${minutesToWeatherChange()} min)`);
      showToast(scene, light);
      showToast(scene, `Fish of the day: ${fishOfTheDay().name} +${WORLD.fishOfTheDayBonus * 100}%`);
    });
    this.refresh(true);
  }

  /** Call every frame. */
  update(dt: number, time: number): void {
    if (time - this.lastCheck > 1000) this.refresh();
    this.updateRain(dt);
    if (this.current === 'storm' && time > this.nextBolt) {
      this.nextBolt = time + 6000 + Math.random() * 9000;
      this.flash.setAlpha(0.55);
      this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 450 });
      sfx.bump();
    }
  }

  private refresh(force = false): void {
    this.lastCheck = this.scene.time.now;
    this.current = weather();
    this.dark = darkness();
    // Clouds and rain dim the day a little; night goes deep blue.
    const gloom = this.current === 'storm' ? 0.35 : this.current === 'rain' ? 0.2 : this.current === 'cloudy' ? 0.08 : 0;
    const k = Math.min(1, this.dark * 0.55 + gloom);
    const r = Math.round(255 - k * (255 - 70));
    const g = Math.round(255 - k * (255 - 90));
    const b = Math.round(255 - k * (255 - 150));
    this.tint.setFillStyle((r << 16) | (g << 8) | b);

    const want = this.current === 'storm' ? 150 : this.current === 'rain' ? 70 : 0;
    while (this.drops.length < want) this.drops.push({ x: Math.random() * GAME_WIDTH, y: Math.random() * GAME_HEIGHT, speed: 600 + Math.random() * 300 });
    this.drops.length = want;

    const key = `${this.current}-${isNight()}`;
    if (key !== this.shown || force) {
      this.shown = key;
      this.drawBadge();
    }
  }

  private updateRain(dt: number): void {
    const g = this.rain.clear();
    if (this.drops.length === 0) return;
    const slant = this.current === 'storm' ? 0.35 : 0.15;
    g.lineStyle(1.5, 0xcfe8ff, 0.55);
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x -= d.speed * slant * dt;
      if (d.y > GAME_HEIGHT) {
        d.y = -10;
        d.x = Math.random() * (GAME_WIDTH + 80);
      }
      if (d.x < -10) d.x += GAME_WIDTH + 20;
      g.lineBetween(d.x, d.y, d.x + 10 * slant, d.y - 10);
    }
  }

  private drawBadge(): void {
    const g = this.badgeIcon.clear();
    const x = -52;
    if (isNight()) {
      g.fillStyle(0xf1faee).fillCircle(x, 0, 7);
      g.fillStyle(0x0b2545).fillCircle(x + 4, -3, 6);
    } else if (this.current === 'clear') {
      g.fillStyle(0xffd166).fillCircle(x, 0, 7);
    }
    if (this.current !== 'clear') {
      g.fillStyle(this.current === 'storm' ? 0x8d99ae : 0xe9ecef).fillEllipse(x + 3, 2, 16, 9);
      g.fillCircle(x - 1, -1, 5);
      if (this.current === 'rain' || this.current === 'storm') {
        g.lineStyle(1.5, 0x8ecae6);
        for (const dx of [-3, 2, 7]) g.lineBetween(x + dx, 8, x + dx - 2, 13);
      }
      if (this.current === 'storm') g.fillStyle(0xffd166).fillTriangle(x + 4, 6, x + 1, 13, x + 6, 10);
    }
    this.badgeText.setText(`${WEATHER_NAMES[this.current]}${isNight() ? ' · Night' : ''}`).setColor(this.current === 'storm' ? '#ffb4a2' : COLORS.gold);
  }

  /** Current darkness 0..1, for scenes that light lamps at night. */
  get night(): number {
    return this.dark;
  }
}
