// Pages build to `<route>/index.html`, so Cloudflare Pages serves each page at its trailing-slash URL
// and answers the slash-less form with a 308. Internal links use the final URL to skip that hop.
const ASSET_EXTENSION =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|xml|json|txt|webmanifest|pdf|zip|css|js|mjs|woff2?|ttf|otf|mp4|webm)$/iu;
const SUFFIX_START = /[?#]/u;

/** Adds the trailing slash to a site-relative page URL, keeping any query or fragment. */
export function withTrailingSlash(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const suffixIndex = href.search(SUFFIX_START);
  const path = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : href.slice(suffixIndex);
  if (path.endsWith('/') || ASSET_EXTENSION.test(path)) return href;
  return `${path}/${suffix}`;
}

/** URL of a docs page from its content slug, e.g. `getting-started/first-run`. */
export function docsPath(slug: string): string {
  return withTrailingSlash(`/docs/${slug}`);
}

// Only the fields this plugin reads. `@types/hast` is not a website dependency, so it is not imported.
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function visitLinks(node: HastNode) {
  if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string') {
    node.properties.href = withTrailingSlash(node.properties.href);
  }
  for (const child of node.children ?? []) visitLinks(child);
}

/** Rehype plugin: applies {@link withTrailingSlash} to every link in rendered Markdown. */
export function rehypeTrailingSlashLinks() {
  return (tree: HastNode) => visitLinks(tree);
}
