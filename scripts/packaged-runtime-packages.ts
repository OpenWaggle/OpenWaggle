/**
 * The installed packages and files the packaged app loads at run time (scripts/electrobun/stage-node-modules.ts).
 *
 * The main build bundles every dependency it can (`BUNDLED_DEPENDENCIES`, scripts/build-main.ts),
 * so the app needs from `node_modules` only the externals the build leaves to it (native modules,
 * WASM readers, packages that locate files beside themselves), the bundled packages a worker
 * resolves by path, and everything those depend on at run time.
 *
 * A bundled package may still be read for a few files: Pi resolves its README, docs, examples,
 * themes and HTML export templates from its package directory
 * (src/main/adapters/pi/pi-package-directory.ts). Inside the shipped closure, some packages carry
 * builds for other runtimes that Bun never resolves (`PACKAGE_UNLOADED_FILES`).
 */

/**
 * Bundled packages the attachment parser worker resolves from `node_modules` when it loads
 * (src/main/utils/attachment-parser-worker.ts), so a package without them fails to parse.
 */
export const RUNTIME_RESOLVED_PACKAGES = ['jszip', 'mammoth', 'unpdf'] as const

/**
 * Files of bundled packages that their bundled code reads from the package directory, as paths
 * relative to it. Pi reads them through `PI_PACKAGE_DIR` (src/main/apply-pi-package-directory.ts);
 * scripts/pi-package-assets-probe.ts runs Pi's HTML export and theme loading on a packaged copy.
 */
export const BUNDLED_PACKAGE_ASSETS: Readonly<Record<string, readonly string[]>> = {
  '@earendil-works/pi-coding-agent': [
    'package.json',
    'README.md',
    'docs',
    'examples',
    'dist/core/export-html',
    'dist/modes/interactive/theme',
    'dist/modes/interactive/assets',
  ],
}

/**
 * Packages the app installs but never loads, so neither they nor what only they depend on ship:
 * transformers.js's Node build runs inference through onnxruntime-node, not the web runtime.
 */
export const UNLOADED_PACKAGES: ReadonlySet<string> = new Set(['onnxruntime-web'])

/**
 * Files of shipped packages that the app never loads, as globs relative to the package directory;
 * a glob that matches a directory leaves out everything under it. A package's entry points are
 * what Bun resolves for a `require` or an `import()` of the bare name; the rest are builds for
 * browsers, bundlers or other module systems.
 *
 * - lucide: Bun resolves both a `require` and an `import()` to the CommonJS build, and the UMD build
 *   is inlined into the main bundle at build time (`?raw`, src/main/adapters/pi/pi-visualize-skill.ts).
 * - transformers.js: the embedding process loads the file `require.resolve` returns
 *   (`transformers.node.cjs`, src/main/adapters/session-embedding-process.ts) and voice input
 *   imports the package (`transformers.node.mjs`, src/main/ipc/voice-handler.ts); the rest are
 *   web and minified builds, the ONNX web runtime's loader and the TypeScript sources.
 * - underscore: mammoth requires the package, whose Node exports are `underscore-node.{cjs,mjs}`.
 * - zlibjs: only tesseract.js's browser worker requires it (`bin/node-zlib.js` is its `main`).
 * - tesseract.js-core: the attachment parser asks for the LSTM engine (`OEM.LSTM_ONLY`,
 *   src/main/utils/attachment-parser-worker.ts), so tesseract.js loads one of the `*-lstm` cores;
 *   the legacy-engine cores and the browser builds with their WASM inlined (`*.wasm.js`) never load.
 * - playwright-core: Browser preview attaches over CDP; `lib/vite` holds the trace viewer,
 *   recorder and HTML report web apps of Playwright's own tooling.
 */
export const PACKAGE_UNLOADED_FILES: Readonly<Record<string, readonly string[]>> = {
  lucide: ['dist/esm', 'dist/umd'],
  '@huggingface/transformers': [
    'src',
    'types',
    'dist/!(transformers.node.cjs|transformers.node.mjs)',
  ],
  underscore: ['!(package.json|underscore-node.cjs|underscore-node-f.cjs|underscore-node.mjs)'],
  zlibjs: ['bin/!(node-zlib.js)'],
  'tesseract.js-core': ['*.wasm.js', 'tesseract-core{,-simd,-relaxedsimd}.{js,wasm}'],
  'playwright-core': ['lib/vite'],
}
