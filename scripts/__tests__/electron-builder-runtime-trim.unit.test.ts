import { describe, expect, it } from 'vitest'
import {
  prunedRuntimeIssues,
  REQUIRED_RUNTIME_ASAR_ENTRIES,
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
        ...REQUIRED_RUNTIME_ASAR_ENTRIES.filter((entry) => !entry.endsWith('tesseract-core.wasm')),
      ]),
    ).toEqual([
      'ships onnxruntime-web (/node_modules/onnxruntime-web/dist/ort.min.js)',
      'ships better-sqlite3 sources (/node_modules/better-sqlite3/deps/sqlite3/sqlite3.c)',
      'ships tesseract.js-core browser builds (/node_modules/tesseract.js-core/tesseract-core-simd.wasm.js)',
      'ships renderer-only packages (/node_modules/@pierre/diffs/package.json)',
      'misses /node_modules/tesseract.js-core/tesseract-core.wasm',
    ])
  })
})
