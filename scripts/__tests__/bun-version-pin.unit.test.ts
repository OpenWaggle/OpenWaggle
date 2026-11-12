import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Bun is pinned in three places that must agree: `packageManager` in package.json (read by
 * oven-sh/setup-bun through `bun-version-file` in CI), `.bun-version` (read by local version
 * managers), and the Bun the package consumer smoke expects on PATH.
 */
describe('Bun version pin', () => {
  it('names one exact Bun version everywhere', () => {
    const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
    const packageManager =
      typeof manifest === 'object' && manifest !== null && 'packageManager' in manifest
        ? manifest.packageManager
        : undefined
    expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/u)
    const version = String(packageManager).slice('bun@'.length)

    expect(readFileSync('.bun-version', 'utf8')).toBe(`${version}\n`)
    expect(readFileSync('scripts/package-consumer-tools.ts', 'utf8')).toContain(
      `{ name: 'bun', version: '${version}' }`,
    )
    for (const workflow of ['ci', 'nightly', 'release', 'package-release', 'session-performance']) {
      const text = readFileSync(`.github/workflows/${workflow}.yml`, 'utf8')
      expect(text, workflow).not.toMatch(/\bbun-version:/u)
    }
  })
})
