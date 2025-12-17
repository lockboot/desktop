import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',  // Use relative paths - works from any subdirectory
  build: {
    // Inline all assets
    assetsInlineLimit: 100000,
  },
});
