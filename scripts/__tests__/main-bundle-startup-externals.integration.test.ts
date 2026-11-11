import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { topLevelRequires } from '../main-bundle-requires'
import {
  externalSpecifiers,
  probeStartupExternals,
  startupExternalFailures,
} from '../main-bundle-startup-externals'

/**
 * R6 P3-4: `check:main-bundle` must catch a package that loads at startup even though its load
 * sits in a function, as a lazy external does when an initializer that runs at startup calls it.
 * Child processes: integration tier.
 */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const PACKAGES = ['sharp', 'better-sqlite3', 'ajv']

async function bundle(source: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'startup-externals-'))
  roots.push(root)
  const file = path.join(root, 'index.js')
  await writeFile(file, source)
  return file
}

/** The shape scripts/build-main-plugins.ts emits: a lazy CommonJS stand-in for an external. */
const LAZY_STAND_IN = `
import path from 'node:path'
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports)
var require_sharp = __commonJS((exports, module) => { module.exports = import.meta.require('sharp') })
var sharp
var initImage = () => { sharp = require_sharp() }
export const base = path.basename('/a/b')
`

describe('main bundle startup externals', () => {
  it('reports a package an initializer that runs at startup loads, which the static check misses', async () => {
    const source = `${LAZY_STAND_IN}\ninitImage()\n`
    const file = await bundle(source)
    expect(topLevelRequires(source)).toEqual(['node:path'])

    const [result] = probeStartupExternals(file, PACKAGES, process.execPath, [['host', 'start']])
    expect(result?.loaded).toEqual(['sharp'])
    expect(startupExternalFailures(result ? [result] : [])).toEqual([
      expect.stringContaining('`openwaggle host start` loads sharp while the main bundle starts'),
    ])
  })

  it('accepts a package whose initializer runs only on use, and passes the argument vector', async () => {
    const file = await bundle(`${LAZY_STAND_IN}
export const resize = () => { initImage(); return sharp }
if (process.argv[2] !== '--version') throw new Error('argv ' + process.argv.slice(2).join(' '))
`)
    const results = probeStartupExternals(file, PACKAGES, process.execPath, [['--version']])
    expect(results).toEqual([{ argv: ['--version'], loaded: [], error: null }])
    expect(startupExternalFailures(results)).toEqual([])
  })

  it('stubs the subpaths of an external the bundle names', async () => {
    const file = await bundle(`const uri = import.meta.require('ajv/dist/runtime/uri')\n`)
    const [result] = probeStartupExternals(file, PACKAGES, process.execPath, [['run', 'probe']])
    expect(result).toMatchObject({ loaded: ['ajv'], error: null })
    expect(externalSpecifiers(["require('ajv/dist/runtime/uri')"], ['ajv'])).toEqual([
      'ajv',
      'ajv/dist/runtime/uri',
    ])
  })

  it('fails a start the stubs could not complete, since it may hide later loads', async () => {
    const file = await bundle(`import 'not-an-external-package'\n`)
    const failures = startupExternalFailures(
      probeStartupExternals(file, PACKAGES, process.execPath, [['run', 'probe']]),
    )
    expect(failures).toEqual([
      expect.stringContaining('`openwaggle run probe` threw while the main bundle started'),
    ])
  })
})
