import path from 'node:path'
import type { Violation } from './violation'

/**
 * Every dependency OpenWaggle installs is pinned to an exact version, so an upgrade is a reviewed
 * change instead of a minor or patch release arriving on the next install
 * (docs/dependency-updates.md). Only the repository's own manifests are checked: fixture packages
 * are test inputs, and peer dependencies state what a published package accepts from its host.
 */
const CHECKED_MANIFESTS = /^(?:package\.json|packages\/[^/]+\/package\.json|website\/package\.json)$/
const PINNED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/**
 * `catalog:` versions are exact in pnpm-workspace.yaml (`check:pi-runtime` enforces the Pi
 * catalog), and `workspace:` links a monorepo package that pnpm rewrites when it publishes.
 */
const PINNED_PROTOCOL = /^(?:catalog|workspace):/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPinnedDependencyVersion(version: string) {
  return EXACT_VERSION.test(version) || PINNED_PROTOCOL.test(version)
}

export function collectExactDependencyVersionViolations(file: string, contents: string) {
  const normalized = file.split(path.sep).join('/')
  if (!CHECKED_MANIFESTS.test(normalized)) return []
  const manifest: unknown = JSON.parse(contents)
  if (!isRecord(manifest)) return []

  const violations: Violation[] = []
  for (const section of PINNED_SECTIONS) {
    const dependencies = manifest[section]
    if (!isRecord(dependencies)) continue
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === 'string' && isPinnedDependencyVersion(version)) continue
      violations.push({
        file: normalized,
        message: `Pin ${section} to exact versions; see docs/dependency-updates.md`,
        detail: `${name}: ${String(version)}`,
      })
    }
  }
  return violations
}
