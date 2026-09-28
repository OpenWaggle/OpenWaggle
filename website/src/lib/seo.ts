export const SITE_URL = 'https://openwaggle.ai';
export const SITE_NAME = 'OpenWaggle';
export const GITHUB_URL = 'https://github.com/OpenWaggle/OpenWaggle';

export const DEFAULT_TITLE = 'OpenWaggle | Desktop AI coding agent with multi-agent Hives';
export const DEFAULT_DESCRIPTION =
  'Free desktop AI coding agent for macOS, Windows, and Linux. Pair two agents on one task, hand work to a Hive of Workers, and use your own models.';

export const DEFAULT_OG_IMAGE = '/og/openwaggle.png';
export const DEFAULT_OG_IMAGE_ALT = 'OpenWaggle. One agent codes. A hive ships.';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export type JsonLd = Record<string, unknown>;

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export function organizationJsonLd(): JsonLd {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    sameAs: [GITHUB_URL],
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export function softwareApplicationJsonLd(): JsonLd {
  return {
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Windows, Linux',
    description: DEFAULT_DESCRIPTION,
    image: `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    screenshot: `${SITE_URL}/screenshots/hive-sessions.png`,
    downloadUrl: `${SITE_URL}/docs/getting-started/installation/`,
    softwareHelp: `${SITE_URL}/docs/getting-started/first-run/`,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export interface Breadcrumb {
  name: string;
  path: string;
}

export function docsArticleJsonLd(input: {
  title: string;
  description: string;
  path: string;
  breadcrumbs: readonly Breadcrumb[];
}): JsonLd[] {
  const url = new URL(input.path, SITE_URL).href;
  return [
    {
      '@type': 'TechArticle',
      headline: input.title,
      description: input.description,
      url,
      mainEntityOfPage: url,
      isPartOf: { '@id': WEBSITE_ID },
      publisher: { '@id': ORGANIZATION_ID },
      about: { '@type': 'SoftwareApplication', name: SITE_NAME },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: input.breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: new URL(crumb.path, SITE_URL).href,
      })),
    },
  ];
}

/** Serializes a JSON-LD graph for an inline script, escaping `<` so content cannot close the tag. */
export function jsonLdScript(nodes: readonly JsonLd[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replaceAll('<', '\\u003c');
}
