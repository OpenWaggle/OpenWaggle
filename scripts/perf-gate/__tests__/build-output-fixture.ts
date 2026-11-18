/**
 * A minimal `electron-vite build` output for the bundle measurements and checks: a boot shim, one
 * main chunk holding every startup module, a worker, a preload, and a renderer whose `index.html`
 * loads an entry and one preloaded chunk, two chat surface chunks and the three deferred assets.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAIN_PROCESSES } from '../../main-bundle-graph'

export interface BuildOutputSizes {
  readonly boot: number
  readonly entry: number
  readonly preloaded: number
  readonly chat: number
  readonly syntaxWorker: number
}

export const PERF_BUILD_MARK = 'OpenWaggle Dev (perf-budgets)'

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function bytes(count: number) {
  return 'x'.repeat(count)
}

/** Writes the output under a new temporary directory and returns it; `boot` includes `mark`. */
export function writeBuildOutput(sizes: BuildOutputSizes, mark = PERF_BUILD_MARK) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-output-'))
  const out = path.join(root, 'out')
  const main = path.join(out, 'main')
  write(path.join(main, 'boot.js'), `${mark}${bytes(sizes.boot - mark.length)}`)
  write(path.join(main, 'index.js'), bytes(1_000))
  write(path.join(main, 'codemode-worker.js'), bytes(100))
  const modules = [...new Set(MAIN_PROCESSES.flatMap((startup) => startup.startupModules))]
  write(
    path.join(main, '.vite', 'main-chunks.json'),
    JSON.stringify([{ file: 'index.js', isEntry: true, modules, imports: [], dynamicImports: [] }]),
  )
  write(path.join(out, 'preload', 'index.js'), bytes(50))
  const renderer = path.join(out, 'renderer')
  const assets = path.join(renderer, 'assets')
  write(
    path.join(renderer, 'index.html'),
    '<script type="module" crossorigin src="./assets/index-a.js"></script>' +
      '<link rel="modulepreload" crossorigin href="./assets/react-a.js">' +
      '<link rel="stylesheet" crossorigin href="./assets/index-a.css">',
  )
  write(path.join(assets, 'index-a.js'), bytes(sizes.entry))
  write(path.join(assets, 'react-a.js'), bytes(sizes.preloaded))
  write(path.join(assets, 'index-a.css'), bytes(10))
  write(path.join(assets, 'welcome-a.js'), bytes(sizes.chat))
  write(path.join(assets, 'session-a.js'), bytes(sizes.chat))
  write(path.join(assets, 'syntax.worker-a.js'), bytes(sizes.syntaxWorker))
  write(path.join(assets, 'FocusedSourceEditor-a.js'), bytes(20))
  write(path.join(assets, 'worker-a.js'), bytes(30))
  write(
    path.join(renderer, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': { file: 'assets/index-a.js', imports: ['_react'], css: ['assets/index-a.css'] },
      _react: { file: 'assets/react-a.js' },
      'src/routes/_chat.index.tsx?tsr-split=component': {
        file: 'assets/welcome-a.js',
        imports: ['_react'],
      },
      'src/routes/sessions.$sessionId.tsx?tsr-split=component': { file: 'assets/session-a.js' },
    }),
  )
  return root
}
