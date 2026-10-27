import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disallowedTopLevelRequires, topLevelRequires } from '../main-bundle-requires'
import { lazyExternalRequiresPlugin } from '../vite/lazy-external-requires'

const FAKE_EXTERNAL = 'openwaggle-fake-external'
const LOADED_FLAG = '__openwaggleFakeExternalLoaded'

let fixtureRoot = ''

async function writeFixture() {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-lazy-external-'))
  const packageRoot = path.join(fixtureRoot, 'node_modules', FAKE_EXTERNAL)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: FAKE_EXTERNAL, main: 'index.js' }))
  await writeFile(
    path.join(packageRoot, 'index.js'),
    `globalThis.${LOADED_FLAG} = true\nexports.answer = 42\n`,
  )
  await writeFile(
    path.join(fixtureRoot, 'used-later.ts'),
    `import { answer } from '${FAKE_EXTERNAL}'\nexport function readAnswer() { return answer }\n`,
  )
  await writeFile(
    path.join(fixtureRoot, 'entry.ts'),
    "export async function run() {\n  const { readAnswer } = await import('./used-later')\n  return readAnswer()\n}\n",
  )
}

async function bundle(label: string, lazy: boolean) {
  const outDir = path.join(fixtureRoot, `out-${label}`)
  await build({
    configFile: false,
    logLevel: 'silent',
    root: fixtureRoot,
    plugins: lazy ? [lazyExternalRequiresPlugin((specifier) => specifier === FAKE_EXTERNAL)] : [],
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: path.join(fixtureRoot, 'entry.ts'),
      outDir,
      emptyOutDir: true,
      minify: false,
      rolldownOptions: {
        external: lazy ? [] : [FAKE_EXTERNAL],
        output: { format: 'cjs', entryFileNames: 'entry.js', codeSplitting: false },
      },
    },
  })
  const file = path.join(outDir, 'entry.js')
  return { file, source: await readFile(file, 'utf8') }
}

function isRunnableBundle(value: unknown): value is { run: () => Promise<unknown> } {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'run') === 'function'
}

describe('lazyExternalRequiresPlugin', () => {
  beforeAll(writeFixture)
  afterAll(async () => {
    Reflect.deleteProperty(globalThis, LOADED_FLAG)
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  it('without it, a one-file CommonJS bundle hoists an external used only by a lazy module', async () => {
    const { source } = await bundle('hoisted', false)

    expect(topLevelRequires(source)).toContain(FAKE_EXTERNAL)
    expect(disallowedTopLevelRequires(source)).toEqual([FAKE_EXTERNAL])
  })

  it('requires the external only when its importer first runs', async () => {
    const { file, source } = await bundle('lazy', true)
    expect(topLevelRequires(source)).not.toContain(FAKE_EXTERNAL)

    Reflect.deleteProperty(globalThis, LOADED_FLAG)
    const loaded: unknown = createRequire(file)(file)
    expect(Reflect.get(globalThis, LOADED_FLAG)).toBeUndefined()
    if (!isRunnableBundle(loaded)) throw new Error('The fixture bundle does not export run().')

    await expect(loaded.run()).resolves.toBe(42)
    expect(Reflect.get(globalThis, LOADED_FLAG)).toBe(true)
  })
})

describe('topLevelRequires', () => {
  it('reads only unindented requires, which run when the bundle loads', () => {
    const source = [
      'let electron = require("electron");',
      'let zod = __toESM$2(require("zod"));',
      'require("side-effect");',
      'var require_lazy = __commonJSMin(((exports, module) => {',
      '\tmodule.exports = require("undici");',
      '}));',
    ].join('\n')

    expect(topLevelRequires(source)).toEqual(['electron', 'zod', 'side-effect'])
    expect(disallowedTopLevelRequires(source)).toEqual(['zod', 'side-effect'])
  })
})
