import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { measureBuild } from '../build-metrics'
import { type BuildOutputSizes, writeBuildOutput } from './build-output-fixture'

const KIBIBYTE = 1024
/** Each one over the ceiling its check script held before the budgets file did. */
const OVER_THE_OLD_CEILINGS: BuildOutputSizes = {
  boot: 29 * KIBIBYTE,
  entry: 385 * KIBIBYTE,
  preloaded: 1_400 * KIBIBYTE,
  chat: 500 * KIBIBYTE,
  syntaxWorker: 321 * KIBIBYTE,
}
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(sizes = OVER_THE_OLD_CEILINGS, mark?: string) {
  const root = writeBuildOutput(sizes, mark)
  roots.push(root)
  return root
}

describe('the build measurement', () => {
  it('measures the boot shim, each process startup and the renderer bundles once held in code', () => {
    const measured = measureBuild(path.join(fixture(), 'out'))

    expect(measured).toMatchObject({
      'main.boot.bytes': 29 * KIBIBYTE,
      'main.startup.gui.bytes': 1_000,
      'main.startup.session-host.bytes': 1_000,
      'main.startup.hive.bytes': 1_000,
      'main.startup.run.bytes': 1_000,
      'main.startup.mcp.bytes': 1_000,
      'renderer.initial.entry.bytes': 385 * KIBIBYTE,
      'renderer.initial.bytes': 1_785 * KIBIBYTE,
      'renderer.chat-surface.bytes': 1_000 * KIBIBYTE,
      'renderer.syntax-worker.bytes': 321 * KIBIBYTE,
      'renderer.focused-editor.bytes': 20,
      'renderer.focused-editor-worker.bytes': 30,
    })
  })

  it('refuses a build made without the one dev slug the budgets assume', () => {
    const out = path.join(fixture(OVER_THE_OLD_CEILINGS, 'OpenWaggle Dev (my-branch)'), 'out')

    expect(() => measureBuild(out)).toThrow(
      'out/ was not built with OPENWAGGLE_DEV_SLUG=perf-budgets',
    )
  })
})

describe('scripts/check-syntax-bundle.ts', () => {
  const script = path.join(process.cwd(), 'scripts/check-syntax-bundle.ts')

  it('passes a renderer over every size it once capped, and prints the sizes', () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: fixture(),
      encoding: 'utf8',
    })

    expect(output).toContain(`renderer.initial.entry.bytes: ${String(385 * KIBIBYTE)} (index-a.js)`)
    expect(output).toContain(`renderer.syntax-worker.bytes: ${String(321 * KIBIBYTE)}`)
  })

  it('still fails a deferred asset in the initial graph', () => {
    const root = fixture()
    const html = path.join(root, 'out/renderer/index.html')
    fs.appendFileSync(html, '<link rel="modulepreload" href="./assets/syntax.worker-a.js">')

    expect(() =>
      execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' }),
    ).toThrow(/Deferred code-rendering assets entered the initial graph: syntax\.worker-a\.js/u)
  })
})
