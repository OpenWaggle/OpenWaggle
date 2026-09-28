import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import rehypeExternalLinks from 'rehype-external-links';
import { isIndexablePage } from './src/lib/sitemap';
import { rehypeTrailingSlashLinks } from './src/lib/site-paths';

export default defineConfig({
  site: 'https://openwaggle.ai',
  output: 'static',
  redirects: { '/docs': '/docs/getting-started/first-run/' },
  integrations: [mdx(), sitemap({ filter: isIndexablePage })],
  markdown: {
    processor: unified({
      rehypePlugins: [
        [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
        rehypeTrailingSlashLinks,
      ],
    }),
  },
  vite: {
    resolve: {
      tsconfigPaths: false,
    },
    plugins: [tailwindcss()],
  },
});
