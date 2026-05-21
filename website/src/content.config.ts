import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const DEFAULT_DOC_ORDER = 999;

const docs = defineCollection({
  loader: glob({ pattern: ['**/*.md', '**/*.mdx'], base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(DEFAULT_DOC_ORDER),
    section: z.string(),
  }),
});

export const collections = { docs };
