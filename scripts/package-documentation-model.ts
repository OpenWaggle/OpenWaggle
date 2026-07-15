export interface PackageDocumentationDefinition {
  readonly apiDescription: string;
  readonly description: string;
  readonly installPackages: string;
  readonly keywords: readonly string[];
  readonly packageName: string;
  readonly slug: string;
  readonly title: string;
  readonly pages: readonly PackageDocumentationPage[];
}

export interface VersionedPackageDocumentationDefinition
  extends PackageDocumentationDefinition {
  readonly currentVersion: string;
  readonly versions: readonly string[];
}

export type PackageDocumentationPage = 'guide' | 'api-reference' | 'components';

const ROUTE_VERSION_GROUP = 2;
const ROUTE_PAGE_GROUP = 3;
const SEMVER_MAJOR_GROUP = 1;
const SEMVER_MINOR_GROUP = 2;
const DOCUMENTATION_VERSION_PATTERN = /^(\d+)\.(\d+)$/u;
const PACKAGE_VERSION_PATTERN = /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function documentationVersionParts(version: string) {
  const match = DOCUMENTATION_VERSION_PATTERN.exec(version);
  const major = Number(match?.[SEMVER_MAJOR_GROUP]);
  const minor = Number(match?.[SEMVER_MINOR_GROUP]);
  if (!match || !Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
    throw new Error(`Invalid package documentation version: ${version}`);
  }
  return { major, minor };
}

export function documentationVersionFromPackageVersion(version: string) {
  const match = PACKAGE_VERSION_PATTERN.exec(version);
  const major = match?.[SEMVER_MAJOR_GROUP];
  const minor = match?.[SEMVER_MINOR_GROUP];
  if (major === undefined || minor === undefined) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return `${major}.${minor}`;
}

export function resolvePackageDocumentationVersions(
  historicalVersions: readonly string[],
  packageVersion: string,
) {
  const currentVersion = documentationVersionFromPackageVersion(packageVersion);
  const versions = [...new Set([...historicalVersions, currentVersion])].sort((left, right) => {
    const leftParts = documentationVersionParts(left);
    const rightParts = documentationVersionParts(right);
    return leftParts.major - rightParts.major || leftParts.minor - rightParts.minor;
  });
  return { currentVersion, versions };
}

export const packageDocumentationDefinitions = [
  {
    apiDescription:
      'Browser-safe extension schemas, manifest contracts, broker helpers, runtime types, themes, and framework-neutral UI helpers.',
    description:
      'Browser-safe OpenWaggle extension SDK schemas, types, broker helpers, theme tokens, and federated-module context helpers.',
    installPackages: '@openwaggle/extension-sdk',
    keywords: ['openwaggle', 'extension', 'sdk', 'typescript', 'module-federation'],
    packageName: '@openwaggle/extension-sdk',
    slug: 'extension-sdk',
    title: 'Extension SDK',
    pages: ['guide', 'api-reference'],
  },
  {
    apiDescription:
      'React primitives, component props, tones, variants, and host-aligned extension UI contracts.',
    description:
      'React UI primitives for OpenWaggle extensions that follow the host extension theme contract.',
    installPackages:
      '@openwaggle/extension-react @openwaggle/extension-sdk react react-dom',
    keywords: ['openwaggle', 'extension', 'react', 'components', 'ui'],
    packageName: '@openwaggle/extension-react',
    slug: 'extension-react',
    title: 'Extension React',
    pages: ['guide', 'api-reference', 'components'],
  },
  {
    apiDescription:
      'Runtime-neutral Waggle configuration, prompts, state, presets, consensus, events, and turn-policy contracts.',
    description:
      'Runtime-neutral Waggle policy, prompts, state, presets, and turn orchestration primitives.',
    installPackages: '@openwaggle/waggle-core',
    keywords: ['openwaggle', 'waggle', 'multi-agent', 'orchestration', 'typescript'],
    packageName: '@openwaggle/waggle-core',
    slug: 'waggle-core',
    title: 'Waggle Core',
    pages: ['guide', 'api-reference'],
  },
  {
    apiDescription:
      'Pi-native Waggle commands, extension lifecycle, loop integration, state, protocol, renderers, presets, and stop policies.',
    description: 'Pi-native Waggle package built on top of @openwaggle/waggle-core.',
    installPackages:
      '@openwaggle/pi-waggle @earendil-works/pi-coding-agent @earendil-works/pi-tui',
    keywords: ['openwaggle', 'waggle', 'pi-package', 'multi-agent', 'orchestration'],
    packageName: '@openwaggle/pi-waggle',
    slug: 'pi-waggle',
    title: 'Pi Waggle',
    pages: ['guide', 'api-reference'],
  },
] as const satisfies readonly PackageDocumentationDefinition[];

export function versionPackageDocumentation(
  definition: PackageDocumentationDefinition,
  versions: readonly string[],
): VersionedPackageDocumentationDefinition {
  const sortedVersions = [...new Set(versions)].sort((left, right) => {
    const leftParts = documentationVersionParts(left);
    const rightParts = documentationVersionParts(right);
    return leftParts.major - rightParts.major || leftParts.minor - rightParts.minor;
  });
  const currentVersion = sortedVersions.at(-1);
  if (currentVersion === undefined) {
    throw new Error(`${definition.packageName} has no package documentation versions.`);
  }
  return { ...definition, currentVersion, versions: sortedVersions };
}

export function packageDocumentationForSlug(
  documentation: readonly VersionedPackageDocumentationDefinition[],
  slug: string,
) {
  return documentation.find((entry) => entry.slug === slug);
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

export function packageDocumentationPage(
  documentation: readonly VersionedPackageDocumentationDefinition[],
  routeSlug: string,
) {
  const match = /^packages\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/u.exec(routeSlug);
  if (!match) {
    return undefined;
  }

  const slug = match[1];
  if (!slug) {
    return undefined;
  }

  const definition = packageDocumentationForSlug(documentation, slug);
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
