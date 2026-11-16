import { describe, expect, it } from 'vitest'
import { collectOverrideCompatibilityViolations } from '../standards/overrides-compatibility'

/**
 * npm 11 rejects a `pkg>dep` `overrides` key and refuses every command from the repository root,
 * which is how an `npx`-launched MCP server stopped starting (see `overrides-compatibility.ts`).
 * A package name may carry an `@range` selector, and a range may contain `>`: `"foo@>=1"` is valid
 * while a bare `pkg>dep` is not, at any depth. Manifests npm never reads from the repo root are
 * left alone.
 */
describe('override keys', () => {
  const manifest = (overrides: unknown) => JSON.stringify({ name: 'openwaggle', overrides })
  const violationDetails = (contents: string) =>
    collectOverrideCompatibilityViolations('package.json', contents).map(
      (violation) => violation.detail,
    )

  it('accepts the parent-object form, a plain name, and a range selector that contains >', () => {
    const contents = manifest({
      '@effect/sql-sqlite-node': { 'better-sqlite3': '13.0.3' },
      'js-yaml@^4': '^4.3.2',
      'foo@>=1': '2.0.0',
      qs: '^6.16.0',
    })

    expect(collectOverrideCompatibilityViolations('package.json', contents)).toEqual([])
  })

  it('accepts a nested override, which npm reads at any depth', () => {
    const contents = manifest({ '@pierre/diffs': { shiki: { 'some-dep': '4.4.3' } } })

    expect(collectOverrideCompatibilityViolations('package.json', contents)).toEqual([])
  })

  it('rejects a parent>child key, which npm refuses and bun resolves', () => {
    const contents = manifest({
      '@effect/sql-sqlite-node>better-sqlite3': '13.0.3',
      'pkg>dep': '4.4.3',
    })

    expect(violationDetails(contents)).toEqual([
      '@effect/sql-sqlite-node>better-sqlite3',
      'pkg>dep',
    ])
  })

  it('rejects a parent>child key nested under a parent, which npm also refuses', () => {
    const contents = manifest({ '@pierre/diffs': { 'shiki>some-dep': '4.4.3' } })

    expect(violationDetails(contents)).toEqual(['shiki>some-dep'])
  })

  it('rejects an override value that is not a version string or a nested object', () => {
    const contents = manifest({ '@pierre/diffs': { shiki: 4 } })

    expect(violationDetails(contents)).toEqual(['shiki'])
  })

  it('leaves manifests without overrides alone', () => {
    expect(collectOverrideCompatibilityViolations('package.json', '{"name":"x"}')).toEqual([])
    expect(collectOverrideCompatibilityViolations('src/main/x.ts', '{"overrides":{}}')).toEqual([])
  })

  it('leaves a fixture manifest alone, which npm never reads from the repo root', () => {
    const contents = manifest({ 'pkg>dep': '1.0.0' })

    expect(
      collectOverrideCompatibilityViolations('fixtures/extensions/x/package.json', contents),
    ).toEqual([])
  })
})
