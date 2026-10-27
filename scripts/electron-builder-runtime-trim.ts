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
 *   In Node, tesseract.js picks one of the `tesseract-core*.js` loaders by CPU features and reads
 *   the matching `.wasm` beside it, so every `.js` and `.wasm` pair stays.
 *
 * Renderer-only packages are devDependencies instead: Vite bundles them, and electron-builder
 * ships only `dependencies`.
 */
export const UNUSED_RUNTIME_FILE_PATTERNS = [
  '!node_modules/**/onnxruntime-web{,/**/*}',
  '!node_modules/**/better-sqlite3/{deps,src}{,/**/*}',
  '!node_modules/**/tesseract.js-core/*.wasm.js',
] as const

interface AsarEntryRule {
  readonly label: string
  readonly matches: (entry: string) => boolean
}

const PRUNED_ASAR_ENTRY_RULES: readonly AsarEntryRule[] = [
  { label: 'onnxruntime-web', matches: (entry) => /\/node_modules\/onnxruntime-web(?:\/|$)/u.test(entry) },
  {
    label: 'better-sqlite3 sources',
    matches: (entry) => /\/node_modules\/better-sqlite3\/(?:deps|src)(?:\/|$)/u.test(entry),
  },
  {
    label: 'tesseract.js-core browser builds',
    matches: (entry) => /\/node_modules\/tesseract\.js-core\/[^/]+\.wasm\.js$/u.test(entry),
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
  '/node_modules/tesseract.js-core/tesseract-core.js',
  '/node_modules/tesseract.js-core/tesseract-core.wasm',
  '/node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
  '/node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
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
