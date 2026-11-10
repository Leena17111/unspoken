import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /unspoken/
export default defineConfig({
  base: process.env.PAGES ? '/unspoken/' : '/',
  plugins: [react()],
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
