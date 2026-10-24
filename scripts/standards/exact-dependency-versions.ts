import path from 'node:path'
import { parse } from 'yaml'
import { isRecord } from './records'
import type { Violation } from './violation'

/**
 * Every direct dependency OpenWaggle installs is pinned to an exact version, so an upgrade shows
 * up in a manifest diff and `pnpm update` cannot move it (docs/dependency-updates.md). Only the
 * repository's own manifests and pnpm catalogs are checked: fixture packages are test inputs, peer
 * dependencies state what a published package accepts from its host, and `overrides` in
 * pnpm-workspace.yaml hold deliberate vulnerability floors.
 */
const CHECKED_MANIFESTS = /^(?:package\.json|packages\/[^/]+\/package\.json|website\/package\.json)$/
const PNPM_WORKSPACE = 'pnpm-workspace.yaml'
const PINNED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/**
 * `catalog:` versions are checked where they are defined, in pnpm-workspace.yaml, and `workspace:`
 * links a monorepo package that pnpm rewrites when it publishes.
 */
const PINNED_PROTOCOL = /^(?:catalog|workspace):/

function normalizePath(file: string) {
  return file.split(path.sep).join('/')
}

function manifestViolations(file: string, contents: string) {
  const manifest: unknown = JSON.parse(contents)
  if (!isRecord(manifest)) return []

  const violations: Violation[] = []
  for (const section of PINNED_SECTIONS) {
    const dependencies = manifest[section]
    if (!isRecord(dependencies)) continue
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === 'string' && (EXACT_VERSION.test(version) || PINNED_PROTOCOL.test(version))) {
        continue
      }
      violations.push({
        file,
        message: `Pin ${section} to exact versions; see docs/dependency-updates.md`,
        detail: `${name}: ${String(version)}`,
      })
    }
  }
  return violations
}

/** The default `catalog` and every named catalog under `catalogs`. */
function catalogEntries(workspace: Readonly<Record<string, unknown>>) {
  const catalogs: [string, Readonly<Record<string, unknown>>][] = []
  if (isRecord(workspace.catalog)) catalogs.push(['catalog', workspace.catalog])
  if (isRecord(workspace.catalogs)) {
    for (const [name, catalog] of Object.entries(workspace.catalogs)) {
      if (isRecord(catalog)) catalogs.push([`catalogs.${name}`, catalog])
    }
  }
  return catalogs
}

function catalogViolations(file: string, contents: string) {
  const workspace: unknown = parse(contents)
  if (!isRecord(workspace)) return []

  const violations: Violation[] = []
  for (const [catalogName, catalog] of catalogEntries(workspace)) {
    for (const [name, version] of Object.entries(catalog)) {
      if (typeof version === 'string' && EXACT_VERSION.test(version)) continue
      violations.push({
        file,
        message: `Pin ${catalogName} entries to exact versions; see docs/dependency-updates.md`,
        detail: `${name}: ${String(version)}`,
      })
    }
  }
  return violations
}

export function collectExactDependencyVersionViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (normalized === PNPM_WORKSPACE) return catalogViolations(normalized, contents)
  if (CHECKED_MANIFESTS.test(normalized)) return manifestViolations(normalized, contents)
  return []
}
