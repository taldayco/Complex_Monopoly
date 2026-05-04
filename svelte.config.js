import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter({ config: 'wrangler.adapter.jsonc' }) }
};

export default config;
