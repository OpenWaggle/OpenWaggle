import { describe, expect, it } from 'vitest'
import { selectShard } from '../../coverage-uniqueness'
import { tierConfig } from '../measure'
import { CoverageIndexBuilder, coveredUnits, isCoverageIndex, uniqueUnits } from '../units'

const ROOT = '/repo'

function fileCoverage(statements: number[], arms: number[]) {
  return {
    statementMap: Object.fromEntries(
      statements.map((_, id) => [id, { start: { line: id + 1, column: 2 } }]),
    ),
    s: Object.fromEntries(statements.map((hits, id) => [id, hits])),
    branchMap: { 0: { loc: { start: { line: 9, column: 4 } } } },
    b: { 0: arms },
  }
}

function index(files: Record<string, string[]>) {
  const builder = new CoverageIndexBuilder()
  for (const [file, units] of Object.entries(files)) builder.add(file, units)
  return builder.build('abc', 0)
}

describe('coveredUnits', () => {
  it('keeps the statements and branch arms product and tooling code ran, relative to the root', () => {
    const coverage = {
      '/repo/src/main/a.ts': fileCoverage([1, 0, 4], [0, 2]),
      '/repo/packages/sdk/src/b.ts': fileCoverage([1], [0, 0]),
      '/repo/src/main/__tests__/a.unit.test.ts': fileCoverage([1], [1, 1]),
      '/repo/src/main/test-support/fake.ts': fileCoverage([1], [1, 1]),
      '/repo/scripts/tool.ts': fileCoverage([1], [0, 0]),
      '/repo/vitest.unit.config.ts': fileCoverage([1], [1, 1]),
    }

    expect(coveredUnits(coverage, ROOT)).toEqual([
      'src/main/a.ts:1:2',
      'src/main/a.ts:3:2',
      'src/main/a.ts:9:4#1',
      'packages/sdk/src/b.ts:1:2',
      'scripts/tool.ts:1:2',
    ])
  })
})

describe('the coverage index', () => {
  it('finds the units only the asking file covers, itself included or not', () => {
    const built = index({ 'a.test.ts': ['x', 'shared'], 'b.test.ts': ['shared'] })

    expect(uniqueUnits(built, 'new.test.ts', ['shared', 'fresh'])).toEqual(['fresh'])
    expect(uniqueUnits(built, 'a.test.ts', ['x', 'shared', 'x'])).toEqual(['x'])
    expect(uniqueUnits(built, 'b.test.ts', ['shared'])).toEqual([])
  })

  it('merges shards into the index one run over every file would build', () => {
    const files = {
      'a.test.ts': ['x', 'shared'],
      'b.test.ts': ['shared', 'y'],
      'c.test.ts': ['shared', 'y'],
    }
    const whole = index(files)
    const first = index({ 'a.test.ts': files['a.test.ts'] })
    const second = new CoverageIndexBuilder()
    second.add('b.test.ts', files['b.test.ts'])
    second.add('c.test.ts', files['c.test.ts'])
    second.add('d.test.ts', undefined)
    const merged = new CoverageIndexBuilder()
    merged.merge(first)
    merged.merge(second.build('abc', 0))
    const result = merged.build('abc', 0)

    expect(result.failed).toEqual(['d.test.ts'])
    expect(result.files).toEqual(whole.files)
    expect(result.units).toEqual(whole.units)
    // Two coverers are enough to tell a shared unit.
    expect(result.units).toHaveProperty(['shared', 'length'], 2)
    expect(isCoverageIndex(JSON.parse(JSON.stringify(result)))).toBe(true)
    expect(isCoverageIndex({ version: 0, files: [], failed: [], units: {} })).toBe(false)
  })
})

describe('the measured files', () => {
  it.each([
    ['src/a.unit.test.ts', 'vitest.unit.config.ts'],
    ['src/a.component.test.tsx', 'vitest.component.config.ts'],
    ['src/a.integration.test.ts', 'vitest.integration.config.ts'],
    ['src/a.test.ts', undefined],
    ['src/a.ts', undefined],
  ])('runs %s with %s', (file, config) => {
    expect(tierConfig(file)).toBe(config)
  })

  it('splits the tier files into disjoint shards that cover them all', () => {
    const files = [
      'a.unit.test.ts',
      'b.ts',
      'c.unit.test.ts',
      'd.component.test.tsx',
      'e.unit.test.ts',
    ]
    const shards = [1, 2].map((shard) => selectShard(files, `${shard}/2`))

    expect(shards).toEqual([
      ['a.unit.test.ts', 'd.component.test.tsx'],
      ['c.unit.test.ts', 'e.unit.test.ts'],
    ])
    expect(() => selectShard(files, '3/2')).toThrow('--shard takes <i>/<n>')
  })
})
