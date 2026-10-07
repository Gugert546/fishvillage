import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { incomePerSecond, takeOfflineReport } from './economy';
import { housingCapacity } from './population';
import { state } from './state';

export const UI_DEPTH = 100;

export function makeText(scene: Phaser.Scene, x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: `${size}px`,
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: Math.max(2, Math.round(size / 7)),
    resolution: Math.min(3, window.devicePixelRatio || 1) * 2,
  });
}

/** Linear blend between two 0xRRGGBB colors. */
export function lerpColor(a: number, b: number, t: number): number {
  const k = Phaser.Math.Clamp(t, 0, 1);
  const mix = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function formatCoins(n: number): string {
  const v = Math.floor(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k`;
  return `${v}`;
}

/** Pin an object (and every child, for containers) to the screen so it ignores camera scroll. */
export function fixToScreen<T extends Phaser.GameObjects.GameObject>(obj: T): T {
  if (obj instanceof Phaser.GameObjects.Container) {
    obj.setScrollFactor(0);
    for (const child of obj.list) fixToScreen(child);
  } else if ('setScrollFactor' in obj) {
    (obj as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor(0);
  }
  return obj;
}

export const COLORS = {
  primary: 0xf5a623,
  buy: 0x52b788,
  disabled: 0x6c757d,
  neutral: 0x457b9d,
  danger: 0xc0392b,
  panel: 0x1d3557,
  gold: '#ffe066',
};

export interface Button extends Phaser.GameObjects.Container {
  setEnabledLook(enabled: boolean, color?: number): void;
  setLabel(text: string): void;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  color = COLORS.primary,
  fontSize = 22,
): Button {
  const bg = scene.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0x000000, 0.25);
  const text = makeText(scene, 0, 0, label, fontSize).setOrigin(0.5);
  const c = scene.add.container(x, y, [bg, text]) as Button;
  // Only fire when the press started on this button, so a button that appears under a
  // finger mid-tap (e.g. in a freshly opened dialog) can't be triggered by the release.
  let pressed = false;
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerdown', () => {
    pressed = true;
    bg.setScale(0.95);
  });
  bg.on('pointerout', () => {
    pressed = false;
    bg.setScale(1);
  });
  bg.on('pointerup', () => {
    bg.setScale(1);
    if (!pressed) return;
    pressed = false;
    onClick();
  });
  c.setEnabledLook = (enabled, onColor = color) => bg.setFillStyle(enabled ? onColor : COLORS.disabled);
  c.setLabel = (s) => text.setText(s);
  return c;
}

/** A centered panel over a dimmed screen that swallows taps behind it. */
export class Modal {
  readonly container: Phaser.GameObjects.Container;
  readonly top: number;

  constructor(
    private scene: Phaser.Scene,
    readonly height: number,
  ) {
    const shade = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0).setInteractive();
    const panel = scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 40, height, COLORS.panel)
      .setStrokeStyle(3, 0xf1faee, 0.6);
    this.container = fixToScreen(scene.add.container(0, 0, [shade, panel]).setDepth(UI_DEPTH + 10));
    this.top = GAME_HEIGHT / 2 - height / 2;
  }

  add(...objs: Phaser.GameObjects.GameObject[]): this {
    for (const o of objs) this.container.add(fixToScreen(o));
    return this;
  }

  text(x: number, y: number, s: string, size: number, originX = 0.5): Phaser.GameObjects.Text {
    const t = makeText(this.scene, x, y, s, size).setOrigin(originX, 0.5);
    this.add(t);
    return t;
  }

  destroy(): void {
    this.container.destroy();
  }
}

/** Coins, income and population pinned to the top of the screen. */
export class TopBar {
  private coins: Phaser.GameObjects.Text;
  private income: Phaser.GameObjects.Text;
  private population: Phaser.GameObjects.Text;
  private personIcon: Phaser.GameObjects.Graphics;
  /** Free slot on the right for scene-specific info (e.g. line depth while fishing). */
  readonly right: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, showPopulation = true) {
    this.personIcon = scene.add.graphics();
    this.personIcon.fillStyle(0xf1faee);
    this.personIcon.fillCircle(0, -6, 4.5);
    this.personIcon.fillRoundedRect(-6, 0, 12, 10, 4);
    const items = [
      scene.add.rectangle(0, 0, GAME_WIDTH, 44, 0x000000, 0.35).setOrigin(0),
      scene.add.circle(22, 22, 10, 0xf5c542).setStrokeStyle(2, 0xb8860b),
      (this.coins = makeText(scene, 40, 22, '', 20).setOrigin(0, 0.5)),
      (this.income = makeText(scene, 0, 24, '', 14).setOrigin(0, 0.5).setColor(COLORS.gold)),
      this.personIcon,
      (this.population = makeText(scene, 0, 22, '', 18).setOrigin(0, 0.5)),
      (this.right = makeText(scene, GAME_WIDTH - 14, 22, '', 18).setOrigin(1, 0.5)),
    ];
    for (const o of items) fixToScreen(o).setDepth(UI_DEPTH);
    this.personIcon.setVisible(showPopulation);
    this.population.setVisible(showPopulation);
    this.update();
  }

  update(): void {
    this.coins.setText(formatCoins(state.coins));
    const ips = incomePerSecond();
    this.income.setX(this.coins.x + this.coins.width + 10);
    this.income.setText(ips > 0 ? `+${ips < 10 ? ips.toFixed(1) : Math.round(ips)}/s` : '');

    this.population.setText(`${state.residents.length}/${housingCapacity()}`);
    this.population.setX(GAME_WIDTH - 14 - this.population.width);
    this.personIcon.setPosition(this.population.x - 12, 22);
  }
}

/** Shows the welcome-back popup if income was earned while away. Returns the modal, if any. */
export function showOfflineEarnings(scene: Phaser.Scene, onClose: () => void): Modal | undefined {
  const report = takeOfflineReport();
  if (!report) return undefined;
  const extra = report.residents > 0 ? 30 : 0;
  const m = new Modal(scene, 230 + extra);
  m.text(GAME_WIDTH / 2, m.top + 40, 'Welcome back!', 28);
  m.text(GAME_WIDTH / 2, m.top + 82, 'Your town earned', 18).setAlpha(0.8);
  m.text(GAME_WIDTH / 2, m.top + 122, `+$${formatCoins(report.coins)}`, 34).setColor(COLORS.gold);
  if (report.residents > 0) {
    const who = report.residents === 1 ? '1 new resident' : `${report.residents} new residents`;
    m.text(GAME_WIDTH / 2, m.top + 160, `and ${who} moved in`, 16).setAlpha(0.85);
  }
  m.add(
    makeButton(scene, GAME_WIDTH / 2, m.top + 185 + extra, 160, 46, 'Collect', () => {
      m.destroy();
      onClose();
    }),
  );
  return m;
}
