import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import config from './astro.config.mjs';

export default defineConfig({
  ...config,
  adapter: vercel({ maxDuration: 60 }),
});
