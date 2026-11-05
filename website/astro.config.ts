import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import rehypeExternalLinks from 'rehype-external-links';
import { rehypeZoomableImages } from './src/lib/markdown-images';
import { remarkMermaidDiagrams } from './src/lib/markdown-mermaid';
import { rehypeScrollableTables } from './src/lib/markdown-tables';
import { isIndexablePage } from './src/lib/sitemap';
import { rehypeTrailingSlashLinks } from './src/lib/site-paths';

export default defineConfig({
  site: 'https://openwaggle.ai',
  output: 'static',
  redirects: {
    '/docs': '/docs/getting-started/first-run/',
    // The Sessions CLI became the Hive CLI (ADR 0053).
    '/docs/developer-workflow/sessions-cli': '/docs/developer-workflow/hive-cli/',
  },
  integrations: [mdx(), sitemap({ filter: isIndexablePage })],
  markdown: {
    processor: unified({
      // Runs before Shiki, so ```mermaid blocks become diagrams rather than highlighted code.
      remarkPlugins: [remarkMermaidDiagrams],
      rehypePlugins: [
        // First, so the links it adds to images go through the link plugins below.
        rehypeZoomableImages,
        [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
        rehypeScrollableTables,
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
