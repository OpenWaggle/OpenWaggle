import path from 'node:path'
import { isRecord } from './records'
import type { Violation } from './violation'

/**
 * An `overrides` entry pins a transitive dependency the way npm reads it, because npm and
 * `npx` load the nearest `package.json` and reject a key npm cannot parse: npm 11 stops every
 * command with `Override without name: <pkg>><dep>` while Bun resolves the same `pkg>dep` key
 * without complaint. The failure is quiet until something runs npm from the repository root: an
 * MCP server launched through `npx` never starts (an expired package-runner resolution falls back
 * to `npx`), and only "The package runner probe exited with code 1" reaches the Host log. A
 * transitive pin is the parent's object instead:
 * `{"@effect/sql-sqlite-node": {"better-sqlite3": "13.0.3"}}`.
 */
const MANIFEST = /(?:^|\/)package\.json$/u
const SELECTOR_SEPARATOR = '>'

function overrideViolations(file: string, contents: string) {
  const manifest: unknown = JSON.parse(contents)
  if (!isRecord(manifest) || !isRecord(manifest.overrides)) return []

  const violations: Violation[] = []
  for (const [name, value] of Object.entries(manifest.overrides)) {
    if (name.includes(SELECTOR_SEPARATOR)) {
      violations.push({
        file,
        message: "Write a transitive override as the parent's object; npm rejects a `pkg>dep` key",
        detail: name,
      })
      continue
    }
    if (!isRecord(value)) continue
    for (const [child, version] of Object.entries(value)) {
      if (typeof version === 'string') continue
      violations.push({
        file,
        message: 'Write a transitive override version as a string; npm rejects a nested object',
        detail: `${name}>${child}`,
      })
    }
  }
  return violations
}

export function collectOverrideCompatibilityViolations(file: string, contents: string) {
  const normalized = file.split(path.sep).join('/')
  if (!MANIFEST.test(normalized)) return []
  return overrideViolations(normalized, contents)
}
