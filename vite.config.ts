import { defineConfig } from 'vite';

// GitHub Pages serves the game from /fishvillage/, so production builds need that base path.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/fishvillage/' : '/',
}));
