import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Authentication uses Firebase tokens in HttpOnly cookies, not Astro sessions.
  session: false,
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
});
