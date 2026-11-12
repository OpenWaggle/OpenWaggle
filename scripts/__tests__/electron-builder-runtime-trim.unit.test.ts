import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../electron-builder'
import {
  prunedRuntimeIssues,
  REQUIRED_RUNTIME_ASAR_ENTRIES,
  unshippedPackageIssues,
  unshippedPackagePatterns,
} from '../electron-builder-runtime-trim'

describe('prunedRuntimeIssues', () => {
  it('accepts an asar that keeps the runtime files and drops the unused ones', () => {
    expect(
      prunedRuntimeIssues([
        ...REQUIRED_RUNTIME_ASAR_ENTRIES,
        '/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
        '/node_modules/@earendil-works/pi-tui/package.json',
      ]),
    ).toEqual([])
  })

  it('names each unused package or file group that ships and each runtime file that is missing', () => {
    expect(
      prunedRuntimeIssues([
        '/node_modules/onnxruntime-web/dist/ort.min.js',
        '/node_modules/better-sqlite3/deps/sqlite3/sqlite3.c',
        '/node_modules/tesseract.js-core/tesseract-core-simd.wasm.js',
        '/node_modules/@pierre/diffs/package.json',
        '/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
        '/node_modules/lucide/dist/esm/lucide.mjs',
        ...REQUIRED_RUNTIME_ASAR_ENTRIES.filter(
          (entry) => !entry.endsWith('tesseract-core-lstm.wasm'),
        ),
      ]),
    ).toEqual([
      'ships onnxruntime-web (/node_modules/onnxruntime-web/dist/ort.min.js)',
      'ships better-sqlite3 sources (/node_modules/better-sqlite3/deps/sqlite3/sqlite3.c)',
      'ships tesseract.js-core browser builds (/node_modules/tesseract.js-core/tesseract-core-simd.wasm.js)',
      'ships tesseract.js-core cores that never load (/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm)',
      'ships builds for other runtimes (/node_modules/lucide/dist/esm/lucide.mjs)',
      'ships renderer-only packages (/node_modules/@pierre/diffs/package.json)',
      'misses /node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
    ])
  })

  it('refuses the bundle source maps in the app, but not maps a dependency ships', () => {
    expect(
      prunedRuntimeIssues([
        ...REQUIRED_RUNTIME_ASAR_ENTRIES,
        '/node_modules/zod/index.js.map',
        '/out/main/index.js.map',
        '/out/renderer/assets/index-abc.js.map',
      ]),
    ).toEqual(['ships source maps (/out/main/index.js.map)'])
  })
})

describe('source maps of the minified bundles (R6 P3-5)', () => {
  it('are emitted hidden for the main process and the renderer', async () => {
    const source = await readFile(
      path.join(import.meta.dirname, '..', '..', 'electron.vite.config.ts'),
      'utf8',
    )
    expect(source.match(/sourcemap: 'hidden'/gu)).toHaveLength(2)
    expect(source).not.toMatch(/sourcemap: (?:true|'inline')/u)
  })

  it('are left out of the packaged app', () => {
    expect(config.files).toContain('!out/**/*.map')
  })
})

describe('TypeScript project configs', () => {
  it('are left out of the packaged app, including the strict, shared and website projects', () => {
    expect(config.files).toContain('!tsconfig*.json')
  })
})

describe('unshipped package patterns', () => {
  it('leaves a bundled package out at any depth and keeps the files Pi reads beside itself', () => {
    expect(unshippedPackagePatterns(['effect', '@earendil-works/pi-coding-agent'])).toEqual([
      '!node_modules/{,**/node_modules/}effect{,/**/*}',
      '!node_modules/{,**/node_modules/}@earendil-works/pi-coding-agent/**/*',
      'node_modules/@earendil-works/pi-coding-agent/package.json{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/README.md{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/docs{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/examples{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/dist/core/export-html{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme{,/**/*}',
      'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/assets{,/**/*}',
    ])
  })

  it('names a bundled package that ships and a Pi asset that does not', () => {
    const pi = '/node_modules/@earendil-works/pi-coding-agent'
    const assets = ['package.json', 'README.md', 'docs', 'examples', 'dist/core/export-html']
    const entries = [
      ...assets.map((asset) => `${pi}/${asset}`),
      `${pi}/dist/core/export-html/template.html`,
      `${pi}/dist/modes/interactive/theme`,
      '/node_modules/effect/package.json',
      '/node_modules/sharp/package.json',
    ]
    expect(unshippedPackageIssues(entries, ['effect', '@earendil-works/pi-coding-agent'])).toEqual([
      'ships effect, which the app never loads (/node_modules/effect/package.json)',
      `misses ${pi}/dist/modes/interactive/assets`,
    ])
    expect(
      unshippedPackageIssues(
        [...entries, `${pi}/dist/index.js`],
        ['@earendil-works/pi-coding-agent'],
      ),
    ).toContain(
      `ships @earendil-works/pi-coding-agent, which the app never loads (${pi}/dist/index.js)`,
    )
  })
})
