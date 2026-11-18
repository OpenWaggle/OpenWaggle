import path from 'node:path'
import { isRecord } from './records'
import type { Violation } from './violation'

/**
 * An `overrides` entry pins a transitive dependency the way npm reads it, because npm and `npx`
 * load the nearest `package.json` and reject a key npm cannot parse: npm 11 stops every command
 * with `Override without name: <pkg>><dep>` while Bun resolves the same `pkg>dep` key without
 * complaint. The failure is quiet until something runs npm from the repository root: an MCP server
 * launched through `npx` never starts (an expired package-runner resolution falls back to `npx`),
 * and only "The package runner probe exited with code 1" reaches the Host log.
 *
 * npm's grammar is not "no `>` in a key": a key is a package name with an optional `@range`
 * selector, and a range may contain `>` (`"foo@>=1"`), while a bare `>` outside a name position
 * (`"pkg>dep"`, at any depth) is the pnpm form npm refuses. An override value is a version string
 * or a nested object npm recurses through, so the rule walks the whole tree.
 */
const CHECKED_MANIFESTS =
  /^(?:package\.json|(?:packages|tools)\/[^/]+\/package\.json|website\/package\.json)$/u
const PNPM_SEPARATOR = '>'

/** An override key's package name: everything before its `@range` selector, scope `@` kept. */
function overrideKeyName(key: string) {
  const selectorAt = key.indexOf('@', 1)
  return selectorAt < 0 ? key : key.slice(0, selectorAt)
}

function collectOverrides(file: string, key: string, value: unknown, violations: Violation[]) {
  if (overrideKeyName(key).includes(PNPM_SEPARATOR)) {
    violations.push({
      file,
      message: "Write a transitive override as the parent's object; npm rejects a `pkg>dep` key",
      detail: key,
    })
  }
  if (typeof value === 'string') return
  if (!isRecord(value)) {
    violations.push({
      file,
      message: 'Write an override value as a version string or a nested object',
      detail: key,
    })
    return
  }
  for (const [child, childValue] of Object.entries(value)) {
    collectOverrides(file, child, childValue, violations)
  }
}

export function collectOverrideCompatibilityViolations(file: string, contents: string) {
  const normalized = file.split(path.sep).join('/')
  if (!CHECKED_MANIFESTS.test(normalized)) return []
  const manifest: unknown = JSON.parse(contents)
  if (!isRecord(manifest) || !isRecord(manifest.overrides)) return []

  const violations: Violation[] = []
  for (const [key, value] of Object.entries(manifest.overrides)) {
    collectOverrides(normalized, key, value, violations)
  }
  return violations
}
