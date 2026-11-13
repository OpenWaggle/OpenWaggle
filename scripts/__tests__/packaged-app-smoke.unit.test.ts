import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  nativeProbeInvocation,
  packagedAppArchitecture,
  packagedAppIssues,
} from '../packaged-app-smoke'

const PI = 'node_modules/@earendil-works/pi-coding-agent'
const MODEL = 'resources/session-embedding-model/Xenova/multilingual-e5-small'

/** The app directory of a correctly packaged app, as relative file paths. */
const PACKAGED = [
  'bun/index.js',
  'out/main/boot.js',
  'out/main/index.js',
  'out/preload/electrobun.js',
  'out/renderer/index.html',
  'package.json',
  `${PI}/README.md`,
  `${PI}/docs/codemode.md`,
  `${PI}/dist/core/export-html/template.html`,
  `${PI}/dist/modes/interactive/theme/dark.json`,
  `${PI}/dist/modes/interactive/theme/light.json`,
  `${PI}/examples/hello.ts`,
  'node_modules/onnxruntime-node/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/tesseract.js-core/tesseract-core-lstm.js',
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
  'node_modules/jszip/package.json',
  'node_modules/mammoth/package.json',
  'node_modules/unpdf/package.json',
  'resources/THIRD_PARTY_NOTICES.md',
  'resources/openwaggle-docs/README.md',
  'resources/openwaggle-docs/index.json',
]

describe('packaged app smoke', () => {
  it('passes the app directory package.ts stages', () => {
    expect(packagedAppIssues(PACKAGED)).toEqual([])
  })

  it('fails on missing roots and runtime files, unexpected roots and build output', () => {
    const files = PACKAGED.filter(
      (file) =>
        !file.startsWith('resources/') &&
        file !== 'node_modules/better-sqlite3/lib/index.js' &&
        file !== 'node_modules/mammoth/package.json',
    )
    expect(
      packagedAppIssues([...files, 'src/main/index.ts', 'out/pi-main-bundle-smoke/x.js']),
    ).toEqual([
      'missing resources',
      'unexpected src',
      'unexpected build output out/pi-main-bundle-smoke/x.js',
      'misses node_modules/better-sqlite3/lib/index.js',
      'misses node_modules/mammoth/package.json',
      'misses resources/THIRD_PARTY_NOTICES.md',
      'misses resources/openwaggle-docs/README.md',
      'misses resources/openwaggle-docs/index.json',
    ])
  })

  it('fails on Pi examples, sources, maps and trimmed packages it must not ship or must', () => {
    const files = PACKAGED.filter((file) => !file.startsWith(`${PI}/examples/`))
    expect(
      packagedAppIssues([
        ...files,
        'node_modules/@openwaggle/pi-waggle/src/index.ts',
        'node_modules/@openwaggle/pi-waggle/tsconfig.json',
        `${MODEL}/onnx/model_quantized.onnx`,
        'node_modules/pi-mcp-adapter/index.js',
        'node_modules/onnxruntime-web/dist/ort.js',
        'node_modules/better-sqlite3/deps/sqlite3.c',
        'node_modules/tesseract.js-core/tesseract-core.wasm.js',
        'out/main/index.js.map',
        'node_modules/shiki/dist/index.mjs',
      ]),
    ).toEqual([
      `misses ${PI}/examples/`,
      'ships workspace package sources (node_modules/@openwaggle/pi-waggle/src/index.ts)',
      'ships workspace package tsconfigs (node_modules/@openwaggle/pi-waggle/tsconfig.json)',
      `ships the Session embedding model (${MODEL}/onnx/model_quantized.onnx)`,
      'ships the legacy MCP adapter (node_modules/pi-mcp-adapter/index.js)',
      'ships onnxruntime-web (node_modules/onnxruntime-web/dist/ort.js)',
      'ships better-sqlite3 sources (node_modules/better-sqlite3/deps/sqlite3.c)',
      'ships tesseract.js-core browser builds (node_modules/tesseract.js-core/tesseract-core.wasm.js)',
      'ships source maps (out/main/index.js.map)',
      'ships renderer-only packages (node_modules/shiki/dist/index.mjs)',
    ])
  })

  it('reads the architecture from the Electrobun target directory', () => {
    expect(packagedAppArchitecture('/r/out/electrobun/inner/stable-macos-x64/OpenWaggle.app')).toBe(
      'x64',
    )
    expect(packagedAppArchitecture('/r/out/electrobun/build/stable-win-arm64/OpenWaggle')).toBe(
      'arm64',
    )
    expect(packagedAppArchitecture('/tmp/tree/OpenWaggle')).toBeNull()
  })

  it('probes the native modules with the bundled Bun on the app node_modules', () => {
    const invocation = nativeProbeInvocation('/apps/OpenWaggle.app', 'darwin')
    expect(invocation.command).toBe('/apps/OpenWaggle.app/Contents/MacOS/bun')
    expect(invocation.args[0]).toMatch(/scripts[/\\]native-load-probe\.ts$/u)
    expect(invocation.args[1]).toBe(path.join('/apps/OpenWaggle.app', 'Contents/Resources/app'))
    expect(nativeProbeInvocation('/apps/OpenWaggle', 'win32').command).toBe(
      path.join('/apps/OpenWaggle', 'bin/bun.exe'),
    )
  })
})
