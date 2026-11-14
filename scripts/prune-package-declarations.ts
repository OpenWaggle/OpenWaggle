/**
 * Deletes the `.d.ts` files in a built package's `dist` that none of its typed `exports` reach.
 * The extension SDK compiles its internal Effect schema modules for the JavaScript its tooling
 * entries run, but publishes declarations only for its public types (ADR 0066). Run it from the
 * package directory after `tsc`.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { builtDeclarationFiles, reachableDeclarationFiles } from './support/package-declarations'

const packageRoot = process.cwd()
const reachable = await reachableDeclarationFiles(packageRoot)
for (const file of await builtDeclarationFiles(packageRoot)) {
  if (reachable.has(file)) continue
  await rm(path.join(packageRoot, file))
  await rm(path.join(packageRoot, `${file}.map`), { force: true })
}
