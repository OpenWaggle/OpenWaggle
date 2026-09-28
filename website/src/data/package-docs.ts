import {
  packageDocumentationDefinitions,
  packageDocumentationForSlug as findPackageDocumentationForSlug,
  packageDocumentationPage as resolvePackageDocumentationPage,
  packageDocumentationRoute,
  versionPackageDocumentation,
} from '../../../scripts/package-documentation-model';
import { docsPath } from '../lib/site-paths';

export {
  packageDocumentationPageRoute,
  packageDocumentationRoute,
  packageDocumentationUrl,
} from '../../../scripts/package-documentation-model';
export type {
  PackageDocumentationPage,
  VersionedPackageDocumentationDefinition as PackageDocumentationDefinition,
} from '../../../scripts/package-documentation-model';

const PACKAGE_GUIDE_PATH_PATTERN = /\/packages\/([^/]+)\/(\d+\.\d+)\/index\.md$/u;
const PACKAGE_SLUG_GROUP = 1;
const PACKAGE_VERSION_GROUP = 2;
const packageGuideModules = import.meta.glob('../content/docs/packages/*/*/index.md');

function versionsForSlug(slug: string) {
  return Object.keys(packageGuideModules).flatMap((filePath) => {
    const match = PACKAGE_GUIDE_PATH_PATTERN.exec(filePath);
    const packageSlug = match?.[PACKAGE_SLUG_GROUP];
    const packageVersion = match?.[PACKAGE_VERSION_GROUP];
    return packageSlug === slug && packageVersion ? [packageVersion] : [];
  });
}

export const packageDocumentation = packageDocumentationDefinitions.map((definition) =>
  versionPackageDocumentation(definition, versionsForSlug(definition.slug)),
);


const packageAliases = new Map(packageDocumentation.map((definition) => [`packages/${definition.slug}`, definition]));

/**
 * Canonical URL for a docs slug. Package slugs such as `packages/pi-waggle` are noindex aliases,
 * so they resolve to the current version's page instead.
 */
export function canonicalDocsPath(slug: string): string {
  const definition = packageAliases.get(slug);
  return definition ? packageDocumentationRoute(definition.slug, definition.currentVersion) : docsPath(slug);
}

export function packageDocumentationPage(routeSlug: string) {
  return resolvePackageDocumentationPage(packageDocumentation, routeSlug);
}
