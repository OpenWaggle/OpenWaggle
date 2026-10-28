import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { topLevelRequires } from '../main-bundle-requires'
import { probeStartupExternals, startupExternalFailures } from '../main-bundle-startup-externals'

/**
 * R6 P3-4: `check:main-bundle` must catch a package that loads at startup even though its
 * `require()` sits in a function, as Rolldown's lazy stand-ins do when an initializer that runs at
 * startup calls them. Child processes: integration tier.
 */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function bundle(source: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'startup-externals-'))
  roots.push(root)
  const file = path.join(root, 'index.js')
  await writeFile(file, source)
  return file
}

/** The shape Rolldown emits: a lazy CommonJS stand-in and an ESM initializer that calls it. */
const LAZY_STAND_IN = `
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports)
var __esmMin = (fn, res) => () => (fn && (res = fn((fn = 0))), res)
var require_sharp = __commonJSMin((exports, module) => { module.exports = require('sharp') })
var electron = require('electron')
var sharp
var init_image = __esmMin(() => { sharp = require_sharp() })
`

describe('main bundle startup externals', () => {
  it('reports a package an initializer that runs at startup loads, which the static check misses', async () => {
    const file = await bundle(`${LAZY_STAND_IN}
init_image()
electron.app.whenReady()
`)
    const source = LAZY_STAND_IN
    expect(topLevelRequires(source)).toEqual(['electron'])

    const [result] = probeStartupExternals(file, [['host', 'start']])
    expect(result?.loaded).toEqual(['electron', 'sharp'])
    expect(startupExternalFailures(result ? [result] : [])).toEqual([
      expect.stringContaining('`openwaggle host start` loads sharp while the main bundle starts'),
    ])
  })

  it('accepts a package whose initializer runs only on use, and passes the argument vector', async () => {
    const file = await bundle(`${LAZY_STAND_IN}
module.exports = { resize: () => { init_image(); return sharp } }
if (process.argv[2] !== '--version') throw new Error('argv ' + process.argv.slice(2).join(' '))
`)
    const results = probeStartupExternals(file, [['--version']])
    expect(results).toEqual([{ argv: ['--version'], loaded: ['electron'], error: null }])
    expect(startupExternalFailures(results)).toEqual([])
  })

  it('fails a start the stubs could not complete, since it may hide later loads', async () => {
    const file = await bundle(`require('electron'); throw new Error('cut short')`)
    const failures = startupExternalFailures(probeStartupExternals(file, [['run', 'probe']]))
    expect(failures).toEqual([expect.stringContaining('`openwaggle run probe` threw while the main bundle started')])
  })
})
