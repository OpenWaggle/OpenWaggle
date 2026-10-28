/** Where a package runner's resolved bin is, and how to spawn it as the runner would (D1.2). */
import { accessSync, closeSync, constants, existsSync, openSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { type PackageRunnerLaunch, packageBinPath } from './mcp-package-runner-launch'

export interface ResolvedPackageBin {
  /** What to spawn: the runner's `node` for a JavaScript bin, else the bin itself. */
  readonly command: string
  /** The bin script first for a JavaScript bin. */
  readonly prefixArgs: readonly string[]
  /** The runner's `node_modules/.bin`, kept first on PATH as the runner had it. */
  readonly binDirectory: string
  readonly resolvedAt: number
  readonly pinned: boolean
}

/** A tag or range (`@latest`, none) is resolved again after a day, so updates still arrive. */
export const PACKAGE_BIN_UNPINNED_TTL_MS = 24 * 60 * 60 * 1_000
/** An exact version only needs its files to still exist. */
export const PACKAGE_BIN_PINNED_TTL_MS = 7 * PACKAGE_BIN_UNPINNED_TTL_MS
const SHEBANG_BYTES = 256

const PackageJsonSchema = Schema.Struct({ bin: Schema.optional(Schema.Unknown) })

export function readJson(text: string): unknown {
  try {
    return parseJsonUnknown(text)
  } catch {
    return undefined
  }
}

function firstLineOf(file: string) {
  let descriptor: number | undefined
  try {
    descriptor = openSync(file, 'r')
    const buffer = Buffer.alloc(SHEBANG_BYTES)
    const read = readSync(descriptor, buffer, 0, SHEBANG_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8').split('\n', 1)[0]?.replace(/\r$/u, '') ?? ''
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function isExecutable(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** `#!/usr/bin/env node` or `#!/path/to/node`, and nothing after it. */
const PLAIN_NODE_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+node|\/\S*\/node)\s*$/u

/**
 * How a resolved bin is spawned as the runner would run it: `node <file>` only for a plain node
 * shebang (or a JavaScript file with none). A shebang with flags (`env -S node --no-warnings`) or
 * another runtime (`bun`) runs the file itself, as the runner's `.bin` link does, which only POSIX
 * can; on Windows such a bin keeps the runner. A bin that is not JavaScript is spawned itself.
 */
export function binLaunchOf(
  file: string,
  platform: NodeJS.Platform = process.platform,
): 'node' | 'self' | undefined {
  const firstLine = firstLineOf(file)
  if (firstLine === undefined) return undefined
  if (firstLine.startsWith('#!')) {
    if (PLAIN_NODE_SHEBANG.test(firstLine)) return 'node'
    return platform !== 'win32' && isExecutable(file) ? 'self' : undefined
  }
  return /\.[cm]?js$/u.test(file) ? 'node' : 'self'
}

/**
 * The bin a runner's PATH leads to: the first `node_modules/.bin` entry next to the package. The
 * package's own `package.json` names the file, so Windows `.cmd` shims are never needed.
 */
export async function resolveBinFromProbe(
  probe: { readonly path: string; readonly node: string },
  launch: PackageRunnerLaunch,
  now: number,
): Promise<ResolvedPackageBin | undefined> {
  for (const entry of probe.path.split(path.delimiter)) {
    if (!/node_modules[\\/]\.bin[\\/]?$/u.test(entry)) continue
    const packageDir = path.join(entry, '..', ...launch.packageName.split('/'))
    let text: string
    try {
      text = await readFile(path.join(packageDir, 'package.json'), 'utf8')
    } catch {
      continue
    }
    const packageJson = safeDecodeUnknown(PackageJsonSchema, readJson(text))
    if (!packageJson.success) continue
    const relative = packageBinPath(packageJson.data, launch.packageName, launch.binName)
    if (!relative) return undefined
    const file = path.resolve(packageDir, relative)
    if (!existsSync(file)) return undefined
    const how = binLaunchOf(file)
    if (!how) return undefined
    const javascript = how === 'node'
    return {
      command: javascript ? probe.node : file,
      prefixArgs: javascript ? [file] : [],
      binDirectory: entry,
      resolvedAt: now,
      pinned: launch.pinned,
    }
  }
  return undefined
}
