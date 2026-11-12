import { describe, expect, it } from 'vitest'
import {
  countErrorsByFile,
  evaluateRendererTestTypes,
  isRendererTestFile,
  MINIMUM_RENDERER_TEST_FILES,
} from '../check-renderer-test-types'

const ROOT_FILES = Array.from(
  { length: MINIMUM_RENDERER_TEST_FILES },
  (_, index) => `./src/renderer/src/f${index}.unit.test.ts`,
)
const STRICT = { strict: true, strictNullChecks: true, noImplicitAny: true }
const EXEMPT_ERROR = "src/renderer/src/f1.unit.test.ts(2,3): error TS2741: Property 'b' is missing."
const MAIN_ERROR = "src/main/a.ts(4,5): error TS2322: Type 'string' is not assignable."

function verdict(input: Partial<Parameters<typeof evaluateRendererTestTypes>[0]>) {
  return evaluateRendererTestTypes({
    output: '',
    failed: false,
    compilerOptions: STRICT,
    rootFiles: ROOT_FILES,
    exemptions: [],
    ...input,
  })
}

describe('isRendererTestFile', () => {
  it('counts renderer test files only', () => {
    /*
     * Scoped to src/renderer/ on purpose: this project references the Node one, whose test files
     * also appear in `--listFiles`, so an unscoped count stayed in the hundreds even with every
     * renderer test excluded - measuring the wrong project's health.
     */
    expect(
      isRendererTestFile('/repo/src/renderer/src/features/a/__tests__/a.component.test.tsx'),
    ).toBe(true)
    expect(isRendererTestFile('/repo/src/renderer/src/lib/b.unit.test.ts')).toBe(true)
    expect(isRendererTestFile('/repo/src/main/store/__tests__/c.unit.test.ts')).toBe(false)
    expect(isRendererTestFile('/repo/src/renderer/src/features/a/Component.tsx')).toBe(false)
  })
})

describe('countErrorsByFile', () => {
  it('counts location-prefixed type errors per file', () => {
    const output = [
      "src/renderer/src/a.test.tsx(12,5): error TS2345: Argument of type 'x'.",
      "src/renderer/src/a.test.tsx(20,1): error TS2322: Type 'y'.",
      "src/renderer/src/b.test.ts(3,9): error TS2741: Property 'z' is missing.",
    ].join('\n')

    expect(countErrorsByFile(output)).toEqual({
      'src/renderer/src/a.test.tsx': 2,
      'src/renderer/src/b.test.ts': 1,
    })
  })

  it('parses nothing from a project-level failure, which is why the exit code is also checked', () => {
    /*
     * TS18003 carries no `file(line,col):` prefix and exits 2. A verdict computed from parsed lines
     * alone therefore reported success for a run that checked nothing - the exact `noCheck` state
     * this guard exists to prevent.
     */
    const output =
      "error TS18003: No inputs were found in config file '/repo/tsconfig.renderer-tests.json'."

    expect(countErrorsByFile(output)).toEqual({})
  })
})

describe('evaluateRendererTestTypes', () => {
  it('passes a clean run', () => {
    expect(verdict({}).ok).toBe(true)
  })

  it('tolerates errors only in exempt files, and reports each error line once', () => {
    const output = [EXEMPT_ERROR, MAIN_ERROR, MAIN_ERROR].join('\n')
    const result = verdict({
      output,
      failed: true,
      exemptions: ['src/renderer/src/f1.unit.test.ts'],
    })
    expect(result.ok).toBe(false)
    expect(result.reportedErrors).toEqual([MAIN_ERROR])
    expect(
      verdict({
        output: EXEMPT_ERROR,
        failed: true,
        exemptions: ['src/renderer/src/f1.unit.test.ts'],
      }).ok,
    ).toBe(true)
  })

  it('fails an exemption whose file is clean', () => {
    const result = verdict({ exemptions: ['src/renderer/src/f1.unit.test.ts'] })
    expect(result.ok).toBe(false)
    expect(result.messages[0]).toContain('stale-exemption')
  })

  it('fails a run that could not have checked the renderer tests', () => {
    expect(verdict({ compilerOptions: { ...STRICT, noCheck: true } }).ok).toBe(false)
    expect(verdict({ compilerOptions: { ...STRICT, strictNullChecks: false } }).ok).toBe(false)
    expect(verdict({ failed: true, output: 'error TS18003: No inputs were found.' }).ok).toBe(false)
    expect(verdict({ rootFiles: ROOT_FILES.slice(1) }).ok).toBe(false)
  })
})
