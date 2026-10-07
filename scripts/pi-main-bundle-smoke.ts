/**
 * Builds a small entry with OpenWaggle's real Electron main build configuration and runs it under
 * Node and under Electron as Node. Pi 1.0 loads the codemode sandbox worker, the QuickJS wasm,
 * and the MCP runtime through paths that only break once Pi is bundled into one main chunk, so
 * reading the bundle is not enough: this runs a codemode script and loads the MCP extension
 * against a real stdio server inside the bundle.
 *
 * Usage: pnpm pi-main-bundle:smoke
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { build } from 'electron-vite'
import { PI_WORKER_BUNDLES } from './vite/pi-worker-bundles'

const execFileAsync = promisify(execFile)

const SMOKE_OUT_DIR = path.resolve('out/pi-main-bundle-smoke')
const SMOKE_CONFIG = path.resolve('scripts/support/pi-main-bundle-smoke.electron-vite.config.ts')
/** electron-vite names a `lib.entry` bundle after its entry file. */
const SMOKE_BUNDLE_FILE_NAME = 'pi-main-bundle-smoke-entry.js'
const SMOKE_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** The `electron` package resolves to the Electron binary path when required from Node. */
function electronBinary() {
  const binary: unknown = createRequire(import.meta.url)('electron')
  if (typeof binary !== 'string') throw new Error('Electron is not installed.')
  return binary
}

async function buildSmokeBundle() {
  await build({ configFile: SMOKE_CONFIG })
}

async function runSmoke(label: string, command: string, env: NodeJS.ProcessEnv) {
  const { stdout } = await execFileAsync(command, [path.join(SMOKE_OUT_DIR, SMOKE_BUNDLE_FILE_NAME)], {
    env,
    timeout: SMOKE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  })
  const line = stdout.trim().split('\n').at(-1) ?? ''
  const result: unknown = JSON.parse(line)
  console.log(`${label}: ${line}`)
  return result
}

async function main() {
  await buildSmokeBundle()
  for (const { fileName } of PI_WORKER_BUNDLES) {
    if (!existsSync(path.join(SMOKE_OUT_DIR, fileName))) {
      throw new Error(`The main build did not emit ${fileName}.`)
    }
  }
  try {
    await runSmoke('node', process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: undefined })
    await runSmoke('electron-as-node', electronBinary(), { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
    console.log('Pi main bundle smoke passed: codemode worker, QuickJS wasm, Photon image read, and MCP extension load.')
  } finally {
    await rm(SMOKE_OUT_DIR, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
