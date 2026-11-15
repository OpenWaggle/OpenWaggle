import fs from 'node:fs'
import path from 'node:path'
import micromatch from 'micromatch'
import { describe, expect, it } from 'vitest'
import { PERF_BUILD_ENV } from '../../perf-gate/build-metrics'
import { PERF_BUDGETS_STEP } from '../perf-budgets-step'
import { STEPS } from '../steps'

const RELATIVE_IMPORT = /from '(?<specifier>\.{1,2}\/[^']+)'/gu

/** Repository files `roots` reach by relative imports, themselves included, as repository paths. */
function importClosure(roots: readonly string[]) {
  const seen = new Set<string>()
  const pending = [...roots]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const specifier = (match.groups?.specifier ?? '').replace(/\.(?:ts|js|mjs)$/u, '')
      pending.push(
        path.posix.normalize(path.posix.join(path.posix.dirname(file), `${specifier}.ts`)),
      )
    }
  }
  return [...seen]
}

function uncovered(roots: readonly string[], inputs: readonly string[]) {
  return importClosure(roots).filter((file) => !micromatch.isMatch(file, [...inputs]))
}

function step(id: string) {
  const found = STEPS.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`No check step ${id}.`)
  return found
}

describe('the bundle check steps', () => {
  it('list every file the renderer-bundle build and checks read, for a cache to fingerprint', () => {
    const renderer = step('renderer-bundle')
    const roots = [
      'electron.vite.config.ts',
      'scripts/check-syntax-bundle.ts',
      'scripts/check-main-bundle.ts',
      'scripts/check-renderer-csp.ts',
    ]
    expect(uncovered(roots, renderer.inputs)).toEqual([])
    for (const file of ['bun.lock', 'tsconfig.web.json', 'patches/x@1.0.0.patch']) {
      expect(micromatch.isMatch(file, [...renderer.inputs]), file).toBe(true)
    }
  })

  it('build what perf-budgets measures with the one slug the measurement expects', () => {
    expect(step('renderer-bundle').env).toEqual(PERF_BUILD_ENV)
    const manifest = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    const slug = Object.entries(PERF_BUILD_ENV).map(([name, value]) => `${name}=${value}`)
    expect(manifest).toContain(
      `"check:renderer-bundle": "${slug.join(' ')} electron-vite build && `,
    )
  })

  it('list every file the perf-budgets measurement and package configuration read', () => {
    const inputs = [...PERF_BUDGETS_STEP.inputs]
    for (const file of [
      'package.json',
      'electron-builder.ts',
      'electron.vite.config.ts',
      'bun.lock',
      'tsconfig.node.json',
      'patches/x@1.0.0.patch',
    ]) {
      expect(micromatch.isMatch(file, inputs), file).toBe(true)
    }
    expect(uncovered(['scripts/perf-gate/budgets.ts'], inputs)).toEqual([])
  })

  it('tell the author to update and commit the file, with no constant to raise', () => {
    expect(PERF_BUDGETS_STEP.hint).toContain(
      'run `bun run perf:budgets:update` and commit performance/perf-budgets.json',
    )
  })
})
