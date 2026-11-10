import { execFileSync } from 'node:child_process'

/**
 * Repository scripts run on Bun (`bun scripts/<name>.ts`), but some of them must start the
 * runtime the desktop app ships: Node for the native-module ABI and the main bundle, and Electron.
 * Under Bun, `process.execPath` is the Bun binary, so these helpers find the real executables.
 */

export interface NodeRuntime {
  readonly execPath: string
  readonly version: string
}

let cachedNodeRuntime: NodeRuntime | undefined

function isBunRuntime() {
  return typeof process.versions['bun'] === 'string'
}

/** The Node.js executable on `PATH` (or this process, when it already is Node) and its version. */
export function nodeRuntime(): NodeRuntime {
  if (!isBunRuntime()) return { execPath: process.execPath, version: process.versions.node }
  cachedNodeRuntime ??= readNodeRuntime()
  return cachedNodeRuntime
}

function readNodeRuntime(): NodeRuntime {
  let output: string
  try {
    output = execFileSync(
      'node',
      ['-p', 'JSON.stringify([process.execPath, process.versions.node])'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )
  } catch (error) {
    throw new Error(
      `This script needs Node.js on PATH (see engines.node in package.json): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
    throw new Error('node -p did not report its executable path and version.')
  }
  return { execPath: parsed[0], version: parsed[1] }
}

/** The Bun executable: this process under Bun, otherwise `bun` on `PATH`. */
export function bunExecutable() {
  return isBunRuntime() ? process.execPath : 'bun'
}
