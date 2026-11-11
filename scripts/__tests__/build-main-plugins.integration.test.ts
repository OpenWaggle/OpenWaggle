import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chunkManifest, lazyExternals, packageName, rawImports } from '../build-main-plugins'
import { mainExternalPackages } from '../build-main'
import { bunBuild } from '../support/bun-build'

/** Bundles a fixture with the main build's plugins and runs it on Bun: integration tier. */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'build-main-'))
  roots.push(root)
  await mkdir(path.join(root, 'node_modules/heavy'), { recursive: true })
  await writeFile(
    path.join(root, 'node_modules/heavy/index.js'),
    'globalThis.loads = (globalThis.loads ?? 0) + 1; module.exports = { name: "heavy", size: 3 }\n',
  )
  await writeFile(path.join(root, 'notice.txt'), 'raw text\n')
  await writeFile(
    path.join(root, 'feature.ts'),
    "import heavy, { size } from 'heavy'\nexport const use = () => `${heavy.name}:${size}`\n",
  )
  await writeFile(
    path.join(root, 'entry.ts'),
    [
      "import notice from './notice.txt?raw'",
      'const before = globalThis.loads ?? 0',
      "const used = process.argv[2] === 'use' ? (await import('./feature')).use() : 'idle'",
      'console.log(JSON.stringify({ before, after: globalThis.loads ?? 0, used, notice }))',
    ].join('\n'),
  )
  return root
}

describe('main build plugins', () => {
  it('loads a statically imported external only when its importer first runs', async () => {
    const root = await fixture()
    const result = await bunBuild({
      entrypoints: [path.join(root, 'entry.ts')],
      outdir: path.join(root, 'out'),
      target: 'node',
      format: 'esm',
      plugins: [rawImports(), lazyExternals(new Set(['heavy']))],
      metafile: true,
    })
    expect(result.success).toBe(true)
    const bundle = path.join(root, 'out/entry.js')
    const run = (...args: string[]) =>
      JSON.parse(execFileSync(process.execPath, [bundle, ...args], { encoding: 'utf8' }))
    expect(run()).toEqual({ before: 0, after: 0, used: 'idle', notice: 'raw text\n' })
    expect(run('use')).toEqual({ before: 0, after: 1, used: 'heavy:3', notice: 'raw text\n' })
    const [entry] = chunkManifest(result.metafile?.outputs ?? {})
    expect(entry?.isEntry).toBe(true)
    expect(entry?.modules.some((module) => module.endsWith('feature.ts'))).toBe(true)
  })

  it('names the packages the bundle leaves to node_modules', () => {
    expect(packageName('@scope/name/sub')).toBe('@scope/name')
    expect(packageName('sharp/lib')).toBe('sharp')
    const externals = mainExternalPackages({ dependencies: { sharp: '1', zod: '4' } })
    expect(externals.has('sharp')).toBe(true)
    expect(externals.has('zod')).toBe(false)
  })
})
