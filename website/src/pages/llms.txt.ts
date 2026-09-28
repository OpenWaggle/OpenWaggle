import { getCollection } from 'astro:content';
import { developerDocsNav, docsNav } from '@/data/docs-nav';
import { packageDocumentation, packageDocumentationRoute } from '@/data/package-docs';
import { buildLlmsTxt } from '@/lib/llms-txt';
import { docsPath } from '@/lib/site-paths';

export async function GET() {
  const docs = await getCollection('docs');
  const descriptions = new Map(docs.map((entry) => [entry.id.replace(/\/index$/u, ''), entry.data.description]));
  const packages = new Map(packageDocumentation.map((definition) => [`packages/${definition.slug}`, definition]));

  const sections = [...docsNav, ...developerDocsNav].map((section) => ({
    title: section.title,
    pages: section.items.map((item) => {
      // Package entries in the nav are aliases; point at the current version's canonical page.
      const pkg = packages.get(item.slug);
      const slug = pkg ? `packages/${pkg.slug}/${pkg.currentVersion}` : item.slug;
      return {
        title: item.title,
        path: pkg ? packageDocumentationRoute(pkg.slug, pkg.currentVersion) : docsPath(item.slug),
        description: descriptions.get(slug),
      };
    }),
  }));

  return new Response(buildLlmsTxt(sections), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
