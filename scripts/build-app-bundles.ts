import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * Builds what the app runs (ADR 0064): the main process (`scripts/build-main.ts`), the Electrobun
 * preload (`scripts/build-electrobun-preload.ts`) and the renderer (`vite.renderer.config.ts`),
 * in that order, into `out/`. `bun run build` and the `renderer-bundle` check step run it.
 */
const ROOT = path.resolve(import.meta.dirname, '..')
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

const BUILDS: readonly (readonly string[])[] = [
  [process.execPath, 'scripts/build-main.ts'],
  [process.execPath, 'scripts/build-electrobun-preload.ts'],
  [process.execPath, VITE, 'build', '-c', 'vite.renderer.config.ts', '--logLevel', 'warn'],
]

for (const [command = process.execPath, ...args] of BUILDS) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
