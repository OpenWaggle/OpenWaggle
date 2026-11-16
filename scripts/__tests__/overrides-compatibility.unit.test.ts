import { describe, expect, it } from 'vitest'
import { collectOverrideCompatibilityViolations } from '../standards/overrides-compatibility'

/**
 * npm 11 rejects a `pkg>dep` `overrides` key and refuses every command from the repository root,
 * which is how an `npx`-launched MCP server stopped starting (see `overrides-compatibility.ts`).
 */
describe('override keys', () => {
  const manifest = (overrides: unknown) => JSON.stringify({ name: 'openwaggle', overrides })

  it('accepts the parent-object form, a plain name, and a version selector', () => {
    const contents = manifest({
      '@effect/sql-sqlite-node': { 'better-sqlite3': '13.0.3' },
      'js-yaml@^4': '^4.3.2',
      qs: '^6.16.0',
    })

    expect(collectOverrideCompatibilityViolations('package.json', contents)).toEqual([])
  })

  it('rejects a parent>child key, which npm refuses and bun resolves', () => {
    const contents = manifest({
      '@effect/sql-sqlite-node>better-sqlite3': '13.0.3',
      '@pierre/diffs>shiki': '4.4.3',
    })

    expect(
      collectOverrideCompatibilityViolations('package.json', contents).map(
        (violation) => violation.detail,
      ),
    ).toEqual(['@effect/sql-sqlite-node>better-sqlite3', '@pierre/diffs>shiki'])
  })

  it('rejects a nested value that is not a version string', () => {
    const contents = manifest({ '@pierre/diffs': { shiki: { version: '4.4.3' } } })

    expect(
      collectOverrideCompatibilityViolations('package.json', contents).map(
        (violation) => violation.detail,
      ),
    ).toEqual(['@pierre/diffs>shiki'])
  })

  it('leaves manifests without overrides alone', () => {
    expect(collectOverrideCompatibilityViolations('package.json', '{"name":"x"}')).toEqual([])
    expect(collectOverrideCompatibilityViolations('src/main/x.ts', '{"overrides":{}}')).toEqual([])
  })
})
