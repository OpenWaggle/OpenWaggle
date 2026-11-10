/**
 * Files that a generator writes, and the commands that run each generator. The agent gate treats a
 * change to one of them as a hand edit unless a command matching its generator ran in the same
 * tool call (TOOL-07). Add a generated file here when you add its generator.
 */
export interface GeneratedFiles {
  readonly name: string
  readonly files: RegExp
  readonly generators: RegExp
}

const BUILD_OR_DEV = /\belectron-vite\b|\bvite\b|\btsr generate\b|\bbun run (?:dev|build)\b/u

export const GENERATED_FILES: readonly GeneratedFiles[] = [
  {
    name: 'TanStack route tree',
    files: /^src\/renderer\/src\/routeTree\.gen\.ts$/u,
    generators: BUILD_OR_DEV,
  },
  {
    name: 'package API snapshots',
    files: /^scripts\/api-snapshots\/[^/]+\.api\.md$/u,
    generators: /\bapi:snapshot:update\b|package-api-snapshots\.ts\b.*--update/u,
  },
  {
    name: 'package documentation',
    files:
      /^(?:packages\/[^/]+\/README\.md|website\/src\/content\/docs\/packages\/[^/]+\/[^/]+\/api-reference\.md)$/u,
    generators: /\bpackage-docs:update\b|package-documentation\.ts\b.*--update/u,
  },
  {
    name: 'published JSON Schemas',
    files: /^website\/public\/schemas\/[^/]+\.schema\.json$/u,
    generators: /\bwebsite:schemas\b|generate-published-json-schemas\.ts\b/u,
  },
  {
    name: 'usage statistics catalog',
    files: /^src\/shared\/usage-statistics\/catalog\.generated\.ts$/u,
    generators: /\busage-statistics-catalog:generate\b|generate-usage-statistics-catalog\.ts\b/u,
  },
  {
    name: 'syntax language metadata',
    files: /^src\/renderer\/src\/shared\/lib\/syntax\/bundled-language-metadata\.generated\.ts$/u,
    generators: /\bsyntax-languages:generate\b|generate-syntax-language-metadata\.ts\b/u,
  },
  {
    name: 'Bun lockfile',
    files: /^bun\.lock$/u,
    generators: /\bbun (?:install|i|add|remove|rm|update|link|pm)\b/u,
  },
  {
    name: 'release changelogs and manifest',
    files: /^(?:(?:packages\/[^/]+\/)?CHANGELOG\.md|\.release-please-manifest\.json)$/u,
    generators: /\brelease-please\b/u,
  },
  {
    name: 'generated source',
    files: /\.generated\.[cm]?[jt]sx?$|\.gen\.[cm]?[jt]sx?$/u,
    generators: /\bgenerate\b|:generate\b/u,
  },
]

export function generatedFilesFor(file: string) {
  return GENERATED_FILES.find((entry) => entry.files.test(file))
}

/** Whether one of `commands` runs the generator of `file`. */
export function ranGenerator(file: string, commands: readonly string[]) {
  const entry = generatedFilesFor(file)
  return entry !== undefined && commands.some((command) => entry.generators.test(command))
}
