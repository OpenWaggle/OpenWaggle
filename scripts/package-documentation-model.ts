export interface PackageDocumentationDefinition {
  readonly apiDescription: string;
  readonly currentVersion: string;
  readonly description: string;
  readonly installPackages: string;
  readonly keywords: readonly string[];
  readonly packageName: string;
  readonly slug: string;
  readonly title: string;
  readonly versions: readonly string[];
  readonly pages: readonly PackageDocumentationPage[];
}

export type PackageDocumentationPage = 'guide' | 'api-reference' | 'components';

const ROUTE_VERSION_GROUP = 2;
const ROUTE_PAGE_GROUP = 3;

export const packageDocumentation = [
  {
    apiDescription:
      'Browser-safe extension schemas, manifest contracts, broker helpers, runtime types, themes, and framework-neutral UI helpers.',
    currentVersion: '0.1',
    description:
      'Browser-safe OpenWaggle extension SDK schemas, types, broker helpers, theme tokens, and federated-module context helpers.',
    installPackages: '@openwaggle/extension-sdk',
    keywords: ['openwaggle', 'extension', 'sdk', 'typescript', 'module-federation'],
    packageName: '@openwaggle/extension-sdk',
    slug: 'extension-sdk',
    title: 'Extension SDK',
    versions: ['0.1'],
    pages: ['guide', 'api-reference'],
  },
  {
    apiDescription:
      'React primitives, component props, tones, variants, and host-aligned extension UI contracts.',
    currentVersion: '0.1',
    description:
      'React UI primitives for OpenWaggle extensions that follow the host extension theme contract.',
    installPackages:
      '@openwaggle/extension-react @openwaggle/extension-sdk react react-dom',
    keywords: ['openwaggle', 'extension', 'react', 'components', 'ui'],
    packageName: '@openwaggle/extension-react',
    slug: 'extension-react',
    title: 'Extension React',
    versions: ['0.1'],
    pages: ['guide', 'api-reference', 'components'],
  },
  {
    apiDescription:
      'Runtime-neutral Waggle configuration, prompts, state, presets, consensus, events, and turn-policy contracts.',
    currentVersion: '0.1',
    description:
      'Runtime-neutral Waggle policy, prompts, state, presets, and turn orchestration primitives.',
    installPackages: '@openwaggle/waggle-core',
    keywords: ['openwaggle', 'waggle', 'multi-agent', 'orchestration', 'typescript'],
    packageName: '@openwaggle/waggle-core',
    slug: 'waggle-core',
    title: 'Waggle Core',
    versions: ['0.1'],
    pages: ['guide', 'api-reference'],
  },
  {
    apiDescription:
      'Pi-native Waggle commands, extension lifecycle, loop integration, state, protocol, renderers, presets, and stop policies.',
    currentVersion: '0.1',
    description: 'Pi-native Waggle package built on top of @openwaggle/waggle-core.',
    installPackages:
      '@openwaggle/pi-waggle @earendil-works/pi-coding-agent @earendil-works/pi-tui',
    keywords: ['openwaggle', 'waggle', 'pi-package', 'multi-agent', 'orchestration'],
    packageName: '@openwaggle/pi-waggle',
    slug: 'pi-waggle',
    title: 'Pi Waggle',
    versions: ['0.1'],
    pages: ['guide', 'api-reference'],
  },
] as const satisfies readonly PackageDocumentationDefinition[];

export function packageDocumentationForSlug(slug: string) {
  return packageDocumentation.find((entry) => entry.slug === slug);
}

export function packageDocumentationRoute(slug: string, version: string) {
  return `/docs/packages/${slug}/${version}/`;
}

export function packageDocumentationPageRoute(
  slug: string,
  version: string,
  page: PackageDocumentationPage,
) {
  const baseRoute = packageDocumentationRoute(slug, version);
  return page === 'guide' ? baseRoute : `${baseRoute}${page}/`;
}

export function packageDocumentationUrl(slug: string, version: string) {
  return `https://openwaggle.ai${packageDocumentationRoute(slug, version)}`;
}

export function packageDocumentationPage(routeSlug: string) {
  const match = /^packages\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/u.exec(routeSlug);
  if (!match) {
    return undefined;
  }

  const slug = match[1];
  if (!slug) {
    return undefined;
  }

  const definition = packageDocumentationForSlug(slug);
  if (!definition) {
    return undefined;
  }

  const requestedVersion = match[ROUTE_VERSION_GROUP] ?? definition.currentVersion;
  if (!definition.versions.some((version) => version === requestedVersion)) {
    return undefined;
  }

  const pageSegment = match[ROUTE_PAGE_GROUP];
  const page = pageSegment === 'api-reference' || pageSegment === 'components'
    ? pageSegment
    : 'guide';
  if (!definition.pages.some((candidate) => candidate === page)) {
    return undefined;
  }

  return { definition, page, version: requestedVersion };
}
