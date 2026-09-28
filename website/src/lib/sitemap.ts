import { packageDocumentationDefinitions } from '../../../scripts/package-documentation-model';

// These routes only redirect (and carry `noindex`), so listing them in the sitemap would ask search
// engines to crawl pages we tell them not to index.
const REDIRECT_ONLY_PATHS = new Set([
  '/benchmarks/',
  ...packageDocumentationDefinitions.map(({ slug }) => `/docs/packages/${slug}/`),
]);

/** Sitemap filter: keeps every page except redirect-only aliases. */
export function isIndexablePage(page: string): boolean {
  return !REDIRECT_ONLY_PATHS.has(new URL(page).pathname);
}
