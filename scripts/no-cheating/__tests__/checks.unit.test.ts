import { describe, expect, it } from 'vitest'
import { addedLines } from '../added-lines'
import { formatFinding } from '../findings'
import { lintConfigFindings } from '../lint-config'
import { openRecordFindings } from '../open-records'
import { BUDGETS, PERF_GATE_FILES, ratchetFindings } from '../ratchets'
import {
  type FileState,
  deletedTestFindings,
  skippedTestFindings,
  testSubjects,
} from '../skipped-tests'
import { newSuppressions } from '../suppressions'

const lines = (...text: string[]) => `${text.join('\n')}\n`

describe('added lines', () => {
  it('counts a moved or re-indented line as unchanged', () => {
    expect(addedLines('a\n  b\nc\n', 'c\nb\na\nd\n')).toEqual([{ line: 4, text: 'd' }])
  })
})

describe('lint config loosening', () => {
  const oxlint = lines(
    'const ROOT_RULES = {',
    "  'no-console': 'error',",
    "  complexity: ['error', { max: 15 }],",
    '}',
    'export default {',
    '  options: {',
    '    typeAware: true,',
    '  },',
    '  ignorePatterns: [',
    "    'dist/**',",
    '  ],',
    '}',
  )
  const messages = (after: string, file = 'oxlint.config.mts', before = oxlint) =>
    lintConfigFindings(file, before, after).map(formatFinding)

  it('blocks a rule turned off, a raised limit, a new ignore and a check option turned off', () => {
    const after = oxlint
      .replace("'no-console': 'error'", "'no-console': 'off'")
      .replace('max: 15', 'max: 20')
      .replace("    'dist/**',", "    'dist/**',\n    'src/legacy/**',")
      .replace('typeAware: true', 'typeAware: false')
    expect(messages(after)).toEqual([
      'oxlint.config.mts:2 [no-cheating/lint-config] rule turned off or down to a warning with no comment saying why; fix the code, or add the reason above the entry',
      'oxlint.config.mts:3 [no-cheating/lint-config] max raised from 15 to 20 with no comment saying why; fix the code, or add the reason above the entry',
      'oxlint.config.mts:7 [no-cheating/lint-config] typeAware set to false with no comment saying why; fix the code, or add the reason above the entry',
      'oxlint.config.mts:11 [no-cheating/lint-config] new entry under ignorePatterns with no comment saying why; fix the code, or add the reason above the entry',
    ])
  })

  it('passes a loosening that adds its reason, and any tightening', () => {
    const reasoned = oxlint
      .replace(
        "  'no-console': 'error',",
        "  // The CLI prints to stdout by design.\n  'no-console': 'off',",
      )
      .replace("    'dist/**',", "    'dist/**',\n    'website/dist/**', // build output")
    expect(messages(reasoned)).toEqual([])
    expect(messages(oxlint.replace('max: 15', 'max: 12'))).toEqual([])
    expect(
      messages(
        oxlint.replace("'no-console': 'error',", "'no-console': 'error',\n  curly: 'error',"),
      ),
    ).toEqual([])
  })

  it('takes a group comment as the reason for an entry that joins it, and nothing else', () => {
    const before = lines(
      '{',
      '  "ignoreDependencies": [',
      '    "a",',
      '    // Loaded by name.',
      '    "b",',
      '  ],',
      '}',
    )
    const joined = before.replace('    "b",', '    "b",\n    "c",')
    expect(messages(joined, '.fallowrc.jsonc', before)).toEqual([])
    const ungrouped = before.replace('    "a",', '    "z",\n    "a",')
    expect(messages(ungrouped, '.fallowrc.jsonc', before)).toEqual([
      '.fallowrc.jsonc:3 [no-cheating/lint-config] new entry under ignoreDependencies with no comment saying why; fix the code, or add the reason above the entry',
    ])
  })

  it('takes a new override with its reason inside, and blocks one without', () => {
    const before = lines(
      'const config = {',
      '  ignore: {',
      '    overrides: [',
      '    ],',
      '  },',
      '}',
    )
    const entry = (comment: string) =>
      before.replace(
        '    overrides: [\n',
        `    overrides: [\n      {\n${comment}        files: ['src/a.ts'],\n        rules: ['r'],\n      },\n`,
      )
    expect(
      messages(entry('        // The analyzer misses the cleanup.\n'), 'doctor.config.ts', before),
    ).toEqual([])
    expect(messages(entry(''), 'doctor.config.ts', before)).toHaveLength(2)
  })

  it('blocks a rule set to error that disappears', () => {
    expect(messages(oxlint.replace("  'no-console': 'error',\n", ''))).toEqual([
      'oxlint.config.mts:1 [no-cheating/lint-config] no-console no longer set to error; keep it, or set it off with the reason',
    ])
  })
})

describe('budgets and only-shrinks lists', () => {
  it('blocks a raised budget and a lowered coverage threshold, and passes the reverse', () => {
    const budget = (value: number) => `const MAX_SYNTAX_WORKER_BYTES = ${value} * KIBIBYTE\n`
    expect(
      ratchetFindings('scripts/check-syntax-bundle.ts', budget(320), budget(352)).map(
        formatFinding,
      ),
    ).toEqual([
      'scripts/check-syntax-bundle.ts:1 [no-cheating/budget] bundle budget MAX_SYNTAX_WORKER_BYTES moved from 320 to 352; get under it instead',
    ])
    expect(ratchetFindings('scripts/check-syntax-bundle.ts', budget(352), budget(320))).toEqual([])
    const coverage = (lines: number) => `thresholds: {\n  lines: ${lines},\n  branches: 30,\n}\n`
    expect(ratchetFindings('vitest.config.ts', coverage(40), coverage(35))).toHaveLength(1)
    expect(ratchetFindings('vitest.config.ts', coverage(40), coverage(45))).toEqual([])
    const output = (check: number) => JSON.stringify({ check, verify: 20 })
    expect(
      ratchetFindings('scripts/check/output-budget.json', output(20), output(25)),
    ).toHaveLength(1)
  })

  it('leaves the Performance Gate files to the gate, whose maintainer label can accept a raise', () => {
    expect(
      PERF_GATE_FILES.filter((file) => BUDGETS.some((budget) => budget.files.test(file))),
    ).toEqual([])
    const measured = (value: number) =>
      JSON.stringify({ metrics: { 'ipc.calls': { value, quantum: 1 } } })
    expect(ratchetFindings('performance/perf-budgets.json', measured(22), measured(23))).toEqual([])
    const thresholds = (relative: number) => JSON.stringify({ timing: { relative, absolute: 60 } })
    expect(
      ratchetFindings('performance/perf-gate/thresholds.json', thresholds(0.1), thresholds(0.2)),
    ).toEqual([])
  })

  it('blocks a grown exemption list and passes a shrunk one', () => {
    const tokens = 'scripts/renderer-design-token-exemptions.json'
    const list = (...files: string[]) => `${JSON.stringify(files, null, 2)}\n`
    expect(
      ratchetFindings(tokens, list('a.tsx'), list('a.tsx', 'b.tsx')).map(formatFinding),
    ).toEqual([
      'scripts/renderer-design-token-exemptions.json:1 [no-cheating/only-shrinks] design token exemptions only shrink; new ["b.tsx"]; fix the code instead',
    ])
    expect(ratchetFindings(tokens, list('a.tsx', 'b.tsx'), list('a.tsx'))).toEqual([])
    const types = 'scripts/renderer-test-type-exemptions.json'
    expect(ratchetFindings(types, '[]', '["src/a.test.tsx"]')).toHaveLength(1)
    const adr = (extra: string) =>
      `export const LEGACY_SHARED_ADR_NUMBERS = new Map([\n  ['0015', ['a.md', 'b.md']],${extra}\n])\nconst other = 'x'\n`
    expect(
      ratchetFindings(
        'scripts/standards/adr-numbering.ts',
        adr(''),
        adr("\n  ['0070', ['c.md', 'd.md']],"),
      )[0]?.id,
    ).toBe('only-shrinks')
  })

  it('reads a declared list up to its closing bracket, not a mention in a comment', () => {
    const config = (...files: string[]) =>
      [
        '// OVERSIZED_FILES passed the limits',
        'const OVERSIZED_FILES = [',
        ...files.map((file) => `  '${file}',`),
        ']',
        "const OTHER = ['z.ts']",
      ].join('\n')
    expect(
      ratchetFindings('oxlint.config.mts', config('a.ts'), config('a.ts', 'b.ts')).map(
        formatFinding,
      ),
    ).toEqual([
      'oxlint.config.mts:1 [no-cheating/only-shrinks] files over the size limits only shrink; new b.ts; fix the code instead',
    ])
    expect(ratchetFindings('oxlint.config.mts', config('a.ts', 'b.ts'), config('a.ts'))).toEqual([])
    // A list the base does not declare is new, and left to review like a new file.
    expect(ratchetFindings('oxlint.config.mts', 'const OTHER = []', config('a.ts'))).toEqual([])
  })
})

describe('skipped and deleted tests', () => {
  it('blocks a new skip or focus modifier in a test file only', () => {
    const before = "it('works', () => {})\n"
    const after = "it.skip('works', () => {})\ndescribe.only('x', () => {})\nit.todo('later')\n"
    expect(
      skippedTestFindings('src/__tests__/a.unit.test.ts', before, after).map((f) => f.message),
    ).toEqual([
      'new skip on a test; run it and fix what fails',
      'new only on a test; run it and fix what fails',
      'new todo on a test; run it and fix what fails',
    ])
    expect(skippedTestFindings('src/a.ts', before, after)).toEqual([])
  })

  it('passes a conditional skip with a comment saying when it runs', () => {
    const file = 'website/src/__tests__/a.test.ts'
    const guarded = "// Needs the built site.\nit.skipIf(!built)('renders', () => {})\n"
    expect(skippedTestFindings(file, '', guarded)).toEqual([])
    expect(skippedTestFindings(file, '', "it.skipIf(!built)('renders', () => {})\n")).toHaveLength(
      1,
    )
  })

  it('maps a test file to the code it covers', () => {
    expect(testSubjects('src/main/__tests__/foo.unit.test.ts')).toContain('src/main/foo.ts')
    expect(testSubjects('packages/p/src/bar.test.tsx')).toContain('packages/p/src/bar.tsx')
  })

  it('blocks a deleted test whose code remains, and passes one deleted with its code', async () => {
    const now = new Set(['src/a.ts'])
    const then = new Set(['src/a.ts', 'src/b.ts'])
    const texts = new Map<string, string>()
    const check = (files: readonly FileState[], moved: readonly string[] = []) =>
      deletedTestFindings({
        changes: files,
        moved: new Set(moved),
        exists: (file) => Promise.resolve(now.has(file)),
        existed: (file) => Promise.resolve(then.has(file)),
        textNow: (file) => Promise.resolve(texts.get(file)),
      })
    const deleted = (file: string) => ({ file, existedBefore: true, existsNow: false })
    expect((await check([deleted('src/__tests__/a.unit.test.ts')])).map(formatFinding)).toEqual([
      'src/__tests__/a.unit.test.ts:1 [no-cheating/test] deleted while src/a.ts still exists; restore the test, or merge its cases into a test file that imports it',
    ])
    // Merged into an edited test file that imports the subject: passes.
    const receiver = {
      file: 'src/__tests__/a-flows.integration.test.ts',
      existedBefore: true,
      existsNow: true,
    }
    texts.set(receiver.file, "import { run } from '../a'\n")
    expect(await check([deleted('src/__tests__/a.unit.test.ts'), receiver])).toEqual([])
    // An edited test file that imports something else does not count.
    texts.set(receiver.file, "import { run } from '../b'\n")
    expect(await check([deleted('src/__tests__/a.unit.test.ts'), receiver])).toHaveLength(1)
    texts.clear()
    expect(await check([deleted('src/__tests__/b.unit.test.ts')])).toEqual([])
    const flows = 'src/__tests__/flows.integration.test.ts'
    expect(await check([deleted(flows)])).toHaveLength(1)
    expect(await check([deleted(flows)], [flows])).toEqual([])
    expect(
      await check([deleted('src/__tests__/a.unit.test.ts')], ['src/__tests__/a.unit.test.ts']),
    ).toEqual([])
    expect(await check([deleted('src/__tests__/helpers.ts')])).toEqual([])
    expect(
      await check([
        deleted(flows),
        { file: 'src/flows.ts', existedBefore: true, existsNow: false },
      ]),
    ).toEqual([])
  })
})

describe('new suppressions', () => {
  it('reports only the directives the change added', () => {
    const before = '// @ts-expect-error old\nconst a = 1\n'
    const after = `${before}/* eslint-disable no-console */\n// biome-ignore lint: x\n`
    expect(newSuppressions('src/a.ts', before, after).map(formatFinding)).toEqual([
      'src/a.ts:3 [no-cheating/suppression] new eslint-disable comment; fix the code or the shared config instead',
      'src/a.ts:4 [no-cheating/suppression] new biome-ignore comment; fix the code or the shared config instead',
    ])
  })

  it('skips the checks that name the directives and words outside a comment', () => {
    expect(newSuppressions('src/b.tsx', undefined, '{/* @ts-nocheck */}')).toHaveLength(1)
    expect(newSuppressions('scripts/oxlint/rules/x.ts', undefined, '// eslint-disable')).toEqual([])
    expect(newSuppressions('src/a.ts', '', "const name = 'ts-ignore'\n")).toEqual([])
  })
})

describe('silencing casts', () => {
  it('blocks a new as any, as unknown as or as never', () => {
    const after =
      'const a = b as any\nconst c = d as unknown as E\nconst f = g as never\nconst h = i as const\n'
    expect(newSuppressions('src/a.ts', '', after).map((finding) => finding.message)).toEqual([
      'new `as any` cast; type the value instead',
      'new `as unknown as` cast; type the value instead',
      'new `as never` cast; type the value instead',
    ])
    expect(newSuppressions('src/a.ts', after, after)).toEqual([])
  })
})

describe('new open-record types', () => {
  it.each([
    ['a Record of unknown', 'type Payload = Record<string, unknown>'],
    ['a readonly Record of any', 'let row: Readonly<Record<PropertyKey, any>>'],
    ['an index signature', 'interface Parsed { readonly [key: string]: unknown }'],
    [
      'an open record schema',
      'const s = Schema.Record({\n  key: Schema.String,\n  value: Schema.Unknown,\n})',
    ],
  ])('blocks %s the change added', (_name, code) => {
    const findings = openRecordFindings('src/a.ts', 'const a = 1\n', `const a = 1\n${code}\n`)
    expect(findings.map(formatFinding)).toEqual([
      expect.stringMatching(/^src\/a\.ts:2 \[no-cheating\/open-record\] new open record type/u),
    ])
  })

  it('reports only the open records a file gained, not the ones it reformatted', () => {
    const before = 'type A = Record<string, unknown>\n'
    const after = 'type A =\n  Record<string, unknown>\ntype B = Record<string, unknown>\n'
    expect(openRecordFindings('src/a.ts', before, after).map(formatFinding)).toEqual([
      expect.stringMatching(/^src\/a\.ts:2 \[no-cheating\/open-record\] new open record type/u),
    ])
  })

  it('passes an existing or moved open record, a declared value type and non-TypeScript files', () => {
    const existing =
      'type A = Record<string, unknown>\nconst s = Schema.Record({ key: Schema.String, value: Schema.Unknown })\n'
    expect(openRecordFindings('src/a.ts', existing, `const b = 2\n${existing}`)).toEqual([])
    const reformatted =
      'type A = Readonly<\n  Record<string, unknown>\n>\nconst s = Schema.Record({ key: Schema.String, value: Schema.Unknown })\n'
    expect(openRecordFindings('src/a.ts', existing, reformatted)).toEqual([])
    const declared =
      'type Headers = Record<string, string>\nconst m = Schema.Record({ key: Schema.String, value: jsonValueSchema })\ntype Map = { [id: string]: Session }\n'
    expect(openRecordFindings('src/a.ts', '', declared)).toEqual([])
    expect(openRecordFindings('docs/a.md', '', 'Record<string, unknown>\n')).toEqual([])
    expect(openRecordFindings('src/a.ts', 'x', undefined)).toEqual([])
  })
})
