import { BUNDLED_PACKAGE_ASSETS, PACKAGE_UNLOADED_FILES } from './packaged-runtime-packages'

/**
 * Installed files the packaged app never loads (startup-main.md, A-F10). They made up about a
 * quarter of `app.asar`: download and update size, codesign and Gatekeeper time after an update,
 * and the asar header every process parses.
 *
 * - onnxruntime-web (≈120 MB): transformers.js's Node build inlines the web runtime it needs and
 *   runs inference through onnxruntime-node.
 * - better-sqlite3's SQLite amalgamation and C++ sources (≈10 MB): the addon loads from
 *   `prebuilds/` or `build/Release`; electron-builder rebuilds natives before it copies files.
 * - tesseract.js-core's `*.wasm.js` builds (≈26 MB): the browser variants with the WASM inlined.
 *   In Node, tesseract.js picks one of the `tesseract-core*-lstm.js` loaders by WASM features
 *   and reads the matching `.wasm` beside it (`PACKAGE_UNLOADED_FILES` drops the legacy-engine
 *   ones). Electron's V8 enables relaxed SIMD wherever it enables SIMD, so the SIMD-only loader
 *   never wins there: the relaxed-SIMD one does, or the plain one on a CPU without WASM SIMD.
 * - Builds for other runtimes and the main bundle's own packages (`PACKAGE_UNLOADED_FILES`,
 *   `unshippedPackagePatterns`, scripts/packaged-runtime-packages.ts).
 *
 * Renderer-only packages are devDependencies instead: Vite bundles them, and electron-builder
 * ships only `dependencies`.
 */
export const UNUSED_RUNTIME_FILE_PATTERNS = [
  '!node_modules/**/onnxruntime-web{,/**/*}',
  '!node_modules/**/better-sqlite3/{deps,src}{,/**/*}',
  '!node_modules/**/tesseract.js-core/tesseract-core-simd-lstm.{js,wasm}',
  ...Object.entries(PACKAGE_UNLOADED_FILES).flatMap(([name, globs]) =>
    globs.map((glob) => `!node_modules/{,**/node_modules/}${name}/${glob}{,/**/*}`),
  ),
]

interface AsarEntryRule {
  readonly label: string
  readonly matches: (entry: string) => boolean
}

const PRUNED_ASAR_ENTRY_RULES: readonly AsarEntryRule[] = [
  {
    label: 'onnxruntime-web',
    matches: (entry) => /\/node_modules\/onnxruntime-web(?:\/|$)/u.test(entry),
  },
  {
    label: 'better-sqlite3 sources',
    matches: (entry) => /\/node_modules\/better-sqlite3\/(?:deps|src)(?:\/|$)/u.test(entry),
  },
  {
    label: 'tesseract.js-core browser builds',
    matches: (entry) => /\/node_modules\/tesseract\.js-core\/[^/]+\.wasm\.js$/u.test(entry),
  },
  {
    label: 'tesseract.js-core cores that never load',
    matches: (entry) =>
      /\/node_modules\/tesseract\.js-core\/tesseract-core(?:-simd|-relaxedsimd|-simd-lstm)?\.(?:js|wasm)$/u.test(
        entry,
      ),
  },
  {
    label: 'builds for other runtimes',
    matches: (entry) =>
      /\/node_modules\/(?:lucide\/dist\/(?:esm|umd)|@huggingface\/transformers\/(?:src|dist\/transformers\.web\.js)|underscore\/modules|playwright-core\/lib\/vite)(?:\/|$)/u.test(
        entry,
      ),
  },
  {
    // The minified bundles' hidden source maps are release artifacts, never app files.
    label: 'source maps',
    matches: (entry) => /^\/out\/.+\.map$/u.test(entry),
  },
  {
    label: 'renderer-only packages',
    matches: (entry) =>
      /\/node_modules\/(?:shiki|@shikijs|@pierre\/diffs|lexical|@lexical|@lobehub|@headless-tree|@tanstack\/react-router|@modelcontextprotocol\/ext-apps)(?:\/|$)/u.test(
        entry,
      ),
  },
]

/** Files the runtime loads from those packages, so trimming cannot remove too much. */
export const REQUIRED_RUNTIME_ASAR_ENTRIES = [
  '/node_modules/onnxruntime-node/package.json',
  '/node_modules/better-sqlite3/lib/index.js',
  '/node_modules/tesseract.js-core/tesseract-core-lstm.js',
  '/node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
  '/node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
  '/node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
  '/node_modules/lucide/dist/cjs/lucide.js',
  '/node_modules/@huggingface/transformers/dist/transformers.node.cjs',
  '/node_modules/underscore/underscore-node.cjs',
  '/node_modules/underscore/underscore-node-f.cjs',
  '/node_modules/zlibjs/bin/node-zlib.js',
  '/node_modules/playwright-core/index.js',
  '/node_modules/playwright-core/lib/coreBundle.js',
  '/node_modules/mammoth/package.json',
  '/node_modules/jszip/package.json',
  '/node_modules/unpdf/package.json',
] as const

export function prunedRuntimeIssues(asarEntries: readonly string[]) {
  const entries = new Set(asarEntries)
  const shipped = PRUNED_ASAR_ENTRY_RULES.flatMap((rule) => {
    const first = asarEntries.find((entry) => rule.matches(entry))
    return first ? [`ships ${rule.label} (${first})`] : []
  })
  const missing = REQUIRED_RUNTIME_ASAR_ENTRIES.filter((entry) => !entries.has(entry)).map(
    (entry) => `misses ${entry}`,
  )
  return [...shipped, ...missing]
}

const AT_ANY_DEPTH = 'node_modules/{,**/node_modules/}'
const SELF_AND_CONTENTS = '{,/**/*}'

/**
 * electron-builder `files` patterns that leave out the production packages the main bundle
 * already contains (scripts/packaged-runtime-packages.ts), keeping only the files a bundled
 * package reads from its own directory. They go after the generic exclusions: a later pattern wins.
 */
export function unshippedPackagePatterns(unshipped: readonly string[]) {
  return unshipped.flatMap((name) => {
    const assets = BUNDLED_PACKAGE_ASSETS[name]
    if (!assets) return [`!${AT_ANY_DEPTH}${name}${SELF_AND_CONTENTS}`]
    return [
      `!${AT_ANY_DEPTH}${name}/**/*`,
      ...assets.map((asset) => `node_modules/${name}/${asset}${SELF_AND_CONTENTS}`),
    ]
  })
}

/** Bundled-only packages that still ship, and asset files of bundled packages that do not. */
export function unshippedPackageIssues(
  asarEntries: readonly string[],
  unshipped: readonly string[],
) {
  const entries = new Set(asarEntries)
  const shipped = unshipped.flatMap((name) => {
    const assets = BUNDLED_PACKAGE_ASSETS[name] ?? []
    const root = `/node_modules/${name}/`
    const first = asarEntries.find(
      (entry) =>
        entry.startsWith(root) &&
        !assets.some(
          (asset) =>
            entry === `${root}${asset}` ||
            entry.startsWith(`${root}${asset}/`) ||
            `${root}${asset}`.startsWith(`${entry}/`),
        ),
    )
    return first ? [`ships ${name}, which the app never loads (${first})`] : []
  })
  const missing = Object.entries(BUNDLED_PACKAGE_ASSETS).flatMap(([name, assets]) =>
    assets
      .map((asset) => `/node_modules/${name}/${asset}`)
      .filter((entry) => !entries.has(entry))
      .map((entry) => `misses ${entry}`),
  )
  return [...shipped, ...missing]
}
