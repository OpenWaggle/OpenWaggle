import fs from 'node:fs'
import path from 'node:path'
import micromatch from 'micromatch'
import { describe, expect, it } from 'vitest'
import { PERF_BUDGETS_STEP } from '../perf-budgets-step'

/** Repository files a script imports by a relative path, as repository paths. */
function relativeImports(file: string) {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  return [...source.matchAll(/from '(?<specifier>\.{1,2}\/[^']+)'/gu)].map((match) =>
    path.posix.join(path.posix.dirname(file), `${match.groups?.specifier ?? ''}.ts`),
  )
}

describe('the perf-budgets check step', () => {
  it('re-runs when the build, the package trim or a script the measurement imports changes', () => {
    const inputs = [...PERF_BUDGETS_STEP.inputs]
    for (const file of [
      'package.json',
      'electron-builder.ts',
      'electron.vite.config.ts',
      'scripts/vite/main-externals.ts',
    ]) {
      expect(micromatch.isMatch(file, inputs), file).toBe(true)
    }
    const imported = [
      'scripts/perf-gate/budgets.ts',
      'scripts/perf-gate/package-closure.ts',
      'scripts/perf-gate/build-metrics.ts',
    ]
      .flatMap(relativeImports)
      .filter((file) => !file.startsWith('scripts/support/'))
    expect(imported.filter((file) => !micromatch.isMatch(file, inputs))).toEqual([])
  })
})
