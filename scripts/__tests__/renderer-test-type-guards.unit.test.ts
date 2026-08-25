import { describe, expect, it } from 'vitest'
import { countErrorsByFile, isRendererTestFile } from '../check-renderer-test-types'

describe('isRendererTestFile', () => {
  it('counts renderer test files only', () => {
    /*
     * Scoped to src/renderer/ on purpose: this project references the Node one, whose test files
     * also appear in `--listFiles`, so an unscoped count stayed in the hundreds even with every
     * renderer test excluded - measuring the wrong project's health.
     */
    expect(isRendererTestFile('/repo/src/renderer/src/features/a/__tests__/a.component.test.tsx')).toBe(
      true,
    )
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
