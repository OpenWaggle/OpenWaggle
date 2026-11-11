import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { scriptEnv } from './env'

/**
 * Repository scripts run on Bun (`bun scripts/<name>.ts`), but some of them must start Node: for
 * the native-module ABI, and for the MCP conformance client.
 * Under Bun, `process.execPath` is the Bun binary, so these helpers find the real executables.
 */

export interface NodeRuntime {
  readonly execPath: string
  readonly version: string
}

let cachedNodeRuntime: NodeRuntime | undefined

function isBunRuntime() {
  const { bun } = process.versions
  return typeof bun === 'string'
}

/** The Node.js executable on `PATH` (or this process, when it already is Node) and its version. */
export function nodeRuntime() {
  if (!isBunRuntime()) return { execPath: process.execPath, version: process.versions.node }
  cachedNodeRuntime ??= readNodeRuntime()
  return cachedNodeRuntime
}

const NODE_EXECUTABLE_NAMES = ['node', 'node.exe']

function resolvesTo(file: string, target: string) {
  try {
    return realpathSync(file) === target
  } catch {
    return false
  }
}

/**
 * `PATH` without the directories whose `node` is Bun. `bun --bun` (how the Vitest tiers run) puts
 * one first on `PATH`, so a plain `node` there would start Bun again.
 */
export function pathWithoutBunNode(
  searchPath: string,
  bunExecutablePath: string,
  delimiter: string = path.delimiter,
) {
  const bun = realpathSync(bunExecutablePath)
  return searchPath
    .split(delimiter)
    .filter(
      (directory) =>
        !NODE_EXECUTABLE_NAMES.some((name) => resolvesTo(path.join(directory, name), bun)),
    )
    .join(delimiter)
}

function readNodeRuntime() {
  let output: string
  try {
    output = execFileSync(
      'node',
      ['-p', 'JSON.stringify([process.execPath, process.versions.node])'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: pathWithoutBunNode(scriptEnv().PATH ?? '', process.execPath),
        },
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
