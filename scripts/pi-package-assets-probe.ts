/**
 * Runs Pi's HTML export and theme loading on a packaged app's copy of Pi's package directory, the
 * way the app points Pi at it (`PI_PACKAGE_DIR`, src/main/pi-package-directory-environment.ts), so
 * the packaged asset list (`BUNDLED_PACKAGE_ASSETS`, scripts/packaged-runtime-packages.ts) cannot
 * leave out a file Pi reads. Pi's code comes from the checkout: the app bundles it, so the packaged
 * copy holds only the files Pi reads beside itself. scripts/packaged-app-smoke.ts copies that
 * directory out of `app.asar` and runs:
 *
 *   bun scripts/pi-package-assets-probe.ts <directory holding node_modules/@earendil-works/pi-coding-agent>
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findPiCodingAgentPackageDirectory } from '../src/main/adapters/pi/pi-package-directory'
import { applyPiPackageDirectoryTo } from '../src/main/pi-package-directory-environment'
import { Schema } from '../src/shared/schema'
import { objectFields, unknownField } from './support/object-fields'

const APP_DIRECTORY_ARG_INDEX = 2
const PI_PACKAGE = path.join('node_modules', '@earendil-works', 'pi-coding-agent')
const THEMES = ['dark', 'light'] as const
const PROBE_TEXT = 'packaged HTML export probe'
/** Pi embeds the Session as base64 JSON (export-html/template.html). */
const SESSION_DATA = /<script id="session-data" type="application\/json">([^<]*)<\/script>/u

const piModuleSchema = Schema.Struct({
  getExportTemplateDir: unknownField,
  getThemesDir: unknownField,
  getInteractiveAssetsDir: unknownField,
  getAvailableThemes: unknownField,
  exportFromFile: unknownField,
  CURRENT_SESSION_VERSION: unknownField,
})

type Callable = (...args: readonly unknown[]) => unknown

function isCallable(value: unknown): value is Callable {
  return typeof value === 'function'
}

function probeError(message: string) {
  return new Error(`Pi package assets probe: ${message}`)
}

async function piModule(checkoutPi: string, relative: string) {
  const loaded: unknown = await import(pathToFileURL(path.join(checkoutPi, relative)).href)
  const fields = objectFields(piModuleSchema, loaded)
  if (fields === undefined) throw probeError(`${relative} is not a module`)
  return fields
}

function callable(value: unknown, name: string) {
  if (!isCallable(value)) throw probeError(`Pi no longer exports ${name}`)
  return value
}

function stringResult(value: unknown, name: string) {
  if (typeof value !== 'string') throw probeError(`${name} returned ${String(value)}`)
  return value
}

/** A one-message Session file, the input of Pi's `--export`. */
function writeSessionFile(directory: string, version: unknown) {
  const timestamp = new Date().toISOString()
  const lines = [
    { type: 'session', version, id: 'probe', timestamp, cwd: directory },
    {
      type: 'message',
      id: 'probe-user',
      parentId: null,
      timestamp,
      message: { role: 'user', content: [{ type: 'text', text: PROBE_TEXT }], timestamp: 0 },
    },
  ]
  const file = path.join(directory, 'probe.jsonl')
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return file
}

async function probe(appDirectory: string) {
  const packaged = path.join(path.resolve(appDirectory), PI_PACKAGE)
  if (!existsSync(path.join(packaged, 'package.json'))) {
    throw probeError(`${packaged} has no package.json`)
  }
  applyPiPackageDirectoryTo(packaged, process.env)
  const checkoutPi = findPiCodingAgentPackageDirectory(import.meta.filename)
  if (checkoutPi === undefined) {
    throw probeError('the checkout has no Pi package; run bun install first')
  }

  const config = await piModule(checkoutPi, 'dist/config.js')
  const directories = {
    getExportTemplateDir: config.getExportTemplateDir,
    getThemesDir: config.getThemesDir,
    getInteractiveAssetsDir: config.getInteractiveAssetsDir,
  }
  for (const [name, read] of Object.entries(directories)) {
    const directory = stringResult(callable(read, name)(), name)
    if (!directory.startsWith(packaged)) {
      throw probeError(`${name} is ${directory}, not in ${packaged}`)
    }
    if (!existsSync(directory)) {
      throw probeError(`the package ships no ${path.relative(packaged, directory)}`)
    }
  }

  const theme = await piModule(checkoutPi, 'dist/modes/interactive/theme/theme.js')
  const available = callable(theme.getAvailableThemes, 'getAvailableThemes')()
  const names = Array.isArray(available) ? available.map(String) : []
  const missing = THEMES.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    throw probeError(`no built-in ${missing.join(', ')} theme among ${names.join(', ')}`)
  }

  const sessions = await piModule(checkoutPi, 'dist/core/session-manager.js')
  const exporter = await piModule(checkoutPi, 'dist/core/export-html/index.js')
  const exportFromFile = callable(exporter.exportFromFile, 'exportFromFile')
  const work = mkdtempSync(path.join(os.tmpdir(), 'pi-assets-probe-'))
  try {
    const sessionFile = writeSessionFile(work, sessions.CURRENT_SESSION_VERSION)
    const pages: string[] = []
    for (const themeName of THEMES) {
      const outputPath = path.join(work, `${themeName}.html`)
      // Pi reads every template, vendor script and the theme's JSON here; a missing one throws.
      await exportFromFile(sessionFile, { outputPath, themeName })
      const html = readFileSync(outputPath, 'utf8')
      const data = SESSION_DATA.exec(html)?.[1]
      if (!data || !Buffer.from(data, 'base64').toString('utf8').includes(PROBE_TEXT)) {
        throw probeError(`the ${themeName} export does not carry the Session`)
      }
      pages.push(html)
    }
    if (pages[0] === pages[1]) throw probeError('the dark and light exports are the same page')
    console.log(
      `Pi package assets probe passed: HTML export in ${THEMES.join(' and ')} from ${packaged}`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const appDirectory = process.argv[APP_DIRECTORY_ARG_INDEX]
if (appDirectory === undefined) throw probeError('pass the app directory')
await probe(appDirectory)
