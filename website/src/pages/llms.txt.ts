import { getCollection } from 'astro:content';
import { developerDocsNav, docsNav } from '@/data/docs-nav';
import { canonicalDocsPath } from '@/data/package-docs';
import { buildLlmsTxt } from '@/lib/llms-txt';

export async function GET() {
  const docs = await getCollection('docs');
  // Keyed by URL so package aliases pick up the description of the versioned page they resolve to.
  const descriptions = new Map(
    docs.map((entry) => [canonicalDocsPath(entry.id.replace(/\/index$/u, '')), entry.data.description]),
  );

  const sections = [...docsNav, ...developerDocsNav].map((section) => ({
    title: section.title,
    pages: section.items.map((item) => {
      const path = canonicalDocsPath(item.slug);
      return { title: item.title, path, description: descriptions.get(path) };
    }),
  }));

  return new Response(buildLlmsTxt(sections), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
