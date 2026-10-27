import { describe, expect, it } from 'vitest'
import {
  MAIN_PROCESS_BUDGETS,
  parseMainChunkManifest,
  processStartupChunks,
} from '../main-bundle-graph'

function chunk(file: string, modules: readonly string[], imports: readonly string[] = [], dynamicImports: readonly string[] = []) {
  return { file, isEntry: file === 'index.js', modules, imports, dynamicImports }
}

const manifest = parseMainChunkManifest([
  chunk('index.js', ['src/main/index.ts'], ['shell.js', 'electron'], ['gui.js', 'host.js']),
  chunk('shell.js', ['src/main/main-window.ts']),
  chunk('gui.js', ['src/main/gui-runtime.ts'], ['effect.js']),
  chunk('effect.js', ['effect/Effect.js']),
  chunk('host.js', ['src/main/runtime.ts'], ['pi.js', 'effect.js'], ['lazy-tool.js']),
  chunk('pi.js', ['@earendil-works/pi-ai/index.js']),
  chunk('lazy-tool.js', ['src/main/adapters/pi/rare-tool.ts']),
])

describe('processStartupChunks', () => {
  it("counts the entry's static graph and each startup module's, never another process's", () => {
    expect(processStartupChunks(manifest, ['src/main/gui-runtime.ts'])).toEqual([
      'effect.js',
      'gui.js',
      'index.js',
      'shell.js',
    ])
    expect(processStartupChunks(manifest, ['src/main/runtime.ts'])).toEqual([
      'effect.js',
      'host.js',
      'index.js',
      'pi.js',
      'shell.js',
    ])
  })

  it('counts a one-file bundle whole for every process', () => {
    const single = parseMainChunkManifest([
      chunk('index.js', ['src/main/index.ts', 'src/main/gui-runtime.ts', 'src/main/runtime.ts']),
    ])
    expect(processStartupChunks(single, ['src/main/gui-runtime.ts'])).toEqual(['index.js'])
  })

  it('fails when a budgeted startup module moved, rather than measuring less', () => {
    expect(() => processStartupChunks(manifest, ['src/main/renamed.ts'])).toThrow(
      'No main chunk holds src/main/renamed.ts',
    )
  })
})

describe('MAIN_PROCESS_BUDGETS', () => {
  it('budgets the desktop app, the Session Host and the CLI commands agents run most', () => {
    expect(MAIN_PROCESS_BUDGETS.map((budget) => budget.label)).toEqual([
      'desktop app (GUI)',
      'Session Host',
      'openwaggle hive',
      'openwaggle run',
      'openwaggle mcp',
    ])
  })
})

describe('parseMainChunkManifest', () => {
  it('rejects malformed manifests', () => {
    expect(() => parseMainChunkManifest({})).toThrow('not an array')
    expect(() => parseMainChunkManifest([{ file: 'index.js' }])).toThrow('Malformed')
  })
})
