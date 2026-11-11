/**
 * Builds a small entry with OpenWaggle's real main build (scripts/build-main.ts) and runs it under
 * Bun, the runtime the app's main process, Session Host and CLI run on. Pi 1.0 loads the codemode
 * sandbox worker, the QuickJS wasm, and the MCP runtime through paths that only break once Pi is
 * bundled into one main chunk, so reading the bundle is not enough: this runs a codemode script and
 * loads the MCP extension against a real stdio server inside the bundle. It also loads
 * `@openwaggle/pi-waggle` from the same bundle: the source module its declared Pi extension entry
 * is built from, and the desktop Waggle loop.
 *
 * Usage: bun run pi-main-bundle:smoke
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildMain, PI_WORKERS } from './build-main'

const execFileAsync = promisify(execFile)

const SMOKE_OUT_DIR = path.resolve('out/pi-main-bundle-smoke')
const SMOKE_ENTRY = 'scripts/support/pi-main-bundle-smoke-entry.ts'
/** The main build names the GUI and CLI bundle `index.js`, whatever its entry. */
const SMOKE_BUNDLE_FILE_NAME = 'index.js'
const SMOKE_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

async function runSmoke() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(SMOKE_OUT_DIR, SMOKE_BUNDLE_FILE_NAME)],
    { env: process.env, timeout: SMOKE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
  )
  const line = stdout.trim().split('\n').at(-1) ?? ''
  const result: unknown = JSON.parse(line)
  console.log(`bun: ${line}`)
  return result
}

async function main() {
  await buildMain({ outDirectory: SMOKE_OUT_DIR, entry: SMOKE_ENTRY })
  for (const { fileName } of PI_WORKERS) {
    if (!existsSync(path.join(SMOKE_OUT_DIR, fileName))) {
      throw new Error(`The main build did not emit ${fileName}.`)
    }
  }
  try {
    await runSmoke()
    console.log(
      'Pi main bundle smoke passed: codemode worker, QuickJS wasm, Photon image read, MCP extension load, every OAuth flow, and the pi-waggle extension and desktop loop.',
    )
  } finally {
    await rm(SMOKE_OUT_DIR, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
