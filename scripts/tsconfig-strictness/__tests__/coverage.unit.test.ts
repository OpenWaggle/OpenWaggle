import { describe, expect, it } from 'vitest'
import { configCandidates } from '../compare'
import { coverageOf, isSourceFile, weakening, weakeningMessages } from '../coverage'
import { strictnessRanks } from '../flags'
import { parseJsonc, referencedConfigs } from '../projects'

describe('strictness ranks', () => {
  it('treats an unset strict as on, as TypeScript 7 does', () => {
    expect(strictnessRanks({}).get('strictNullChecks')).toBe(1)
    expect(strictnessRanks({ strict: false }).get('strictNullChecks')).toBe(0)
    expect(strictnessRanks({ strict: false, strictNullChecks: true }).get('strictNullChecks')).toBe(
      1,
    )
  })

  it('ranks allowUnreachableCode false over unset over true, and skipLibCheck on as weaker', () => {
    const ranks = (value: boolean | undefined) =>
      strictnessRanks(value === undefined ? {} : { allowUnreachableCode: value }).get(
        'allowUnreachableCode',
      )
    expect([ranks(false), ranks(undefined), ranks(true)]).toEqual([2, 1, 0])
    expect(strictnessRanks({ skipLibCheck: true }).get('skipLibCheck')).toBe(0)
    expect(strictnessRanks({ noCheck: true }).get('noCheck')).toBe(0)
  })
})

describe('coverage', () => {
  const strict = { config: 'a.json', files: ['src/a.ts'], options: { noUnusedLocals: true } }
  const loose = { config: 'b.json', files: ['src/a.ts', 'src/b.ts'], options: {} }

  it('gives a file the strictest rank of the projects that check it', () => {
    expect(coverageOf([strict, loose]).get('src/a.ts')?.get('noUnusedLocals')).toBe(1)
    expect(coverageOf([strict, loose]).get('src/b.ts')?.get('noUnusedLocals')).toBe(0)
  })

  it('leaves out build outputs and dependencies', () => {
    expect(isSourceFile('packages/p/dist/index.d.ts')).toBe(false)
    expect(isSourceFile('node_modules/x/index.d.ts')).toBe(false)
    expect(isSourceFile('.typecheck/node/a.d.ts')).toBe(false)
    expect(isSourceFile('src/dist.ts')).toBe(true)
  })

  it('reports dropped files and flags in one line each', () => {
    const change = weakening(coverageOf([strict, loose]), coverageOf([loose]))
    expect(weakeningMessages(change)).toEqual(['noUnusedLocals checks less on 1 file: src/a.ts'])
    const dropped = weakening(coverageOf([strict, loose]), coverageOf([strict]))
    expect(weakeningMessages(dropped)).toEqual([
      '1 source file no longer type-checked by any project reachable from tsconfig.json: src/b.ts',
    ])
  })
})

describe('config files', () => {
  it('parses comments and trailing commas but keeps strings intact', () => {
    expect(parseJsonc('{ "a": "http://x, }", /* c */ "b": [1,], }')).toEqual({
      a: 'http://x, }',
      b: [1],
    })
  })

  it('resolves references to files and directories', () => {
    const text = '{ "references": [{ "path": "./tsconfig.node.json" }, { "path": "../tools" }] }'
    expect(referencedConfigs('web/tsconfig.json', text)).toEqual([
      'web/tsconfig.node.json',
      'tools/tsconfig.json',
    ])
  })

  it('finds every tsconfig in a listing', () => {
    expect(
      configCandidates('src/a.ts\0tsconfig.json\0a/tsconfig.build.json', ['gone/tsconfig.json']),
    ).toEqual(['a/tsconfig.build.json', 'gone/tsconfig.json', 'tsconfig.json'])
  })
})
