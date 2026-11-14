import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bunLintPlatformPackages } from '../lint'
import { objectMap } from '../support/object-fields'

function bunLintPins() {
  const manifest: unknown = JSON.parse(readFileSync('tools/bun-lint/package.json', 'utf8'))
  const pins =
    typeof manifest === 'object' && manifest !== null && 'optionalDependencies' in manifest
      ? objectMap(manifest.optionalDependencies)
      : undefined
  if (pins === undefined) {
    throw new Error('tools/bun-lint has no optionalDependencies.')
  }
  return pins
}

describe('bun lint canary pin', () => {
  it('names the Bun binary package for each platform', () => {
    expect(bunLintPlatformPackages('darwin', 'arm64')).toEqual(['@oven/bun-darwin-aarch64'])
    expect(bunLintPlatformPackages('win32', 'x64')).toEqual(['@oven/bun-windows-x64'])
    expect(bunLintPlatformPackages('linux', 'x64')).toEqual([
      '@oven/bun-linux-x64',
      '@oven/bun-linux-x64-musl',
    ])
  })

  it('pins one dated canary for every supported platform in tools/bun-lint', () => {
    const pins = bunLintPins()
    const expected = [
      ...bunLintPlatformPackages('darwin', 'arm64'),
      ...bunLintPlatformPackages('darwin', 'x64'),
      ...bunLintPlatformPackages('linux', 'arm64'),
      ...bunLintPlatformPackages('linux', 'x64'),
      ...bunLintPlatformPackages('win32', 'arm64'),
      ...bunLintPlatformPackages('win32', 'x64'),
    ]
    expect([...pins.keys()].sort()).toEqual(expected.sort())
    const versions = new Set(pins.values())
    expect(versions.size).toBe(1)
    expect([...versions][0]).toMatch(/^\d+\.\d+\.\d+-canary\.\d{8}\.\d+$/u)
  })
})
