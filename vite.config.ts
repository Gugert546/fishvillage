import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the game from /fishvillage/, so production builds need that base path.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/fishvillage/' : '/',
  // The game's version (from package.json), shown in Settings.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
}));
