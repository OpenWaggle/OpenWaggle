/**
 * Package runners (`npx`, `npm exec`, `pnpm dlx`, `bunx`) stay alive as a parent of the MCP server
 * they launch, ~80 MB each and doing nothing after launch, and `@latest` makes every launch ask
 * the registry first (D1.2). Once a server has been launched through its runner, the bin the
 * runner resolved is found with a background probe and later launches spawn it directly. The
 * configured command stays the fallback: whenever the resolution is missing, expired, or its files
 * are gone, the runner launches the server as configured and the probe runs again.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import {
  type PackageRunnerLaunch,
  packageBinPath,
  parsePackageRunnerCommand,
  probeCommand,
} from './mcp-package-runner-launch'

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
const PROBE_TIMEOUT_MS = 180_000
const PROBE_OUTPUT_BYTES = 1_000_000
const SHEBANG_BYTES = 256

const PackageJsonSchema = Schema.Struct({ bin: Schema.optional(Schema.Unknown) })

function readJson(text: string): unknown {
  try {
    return parseJsonUnknown(text)
  } catch {
    return undefined
  }
}

/** Whether the package is installed in a project above `cwd`: a runner uses that copy. */
function installedNear(cwd: string, packageName: string) {
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    if (
      existsSync(path.join(directory, 'node_modules', ...packageName.split('/'), 'package.json'))
    ) {
      return true
    }
    if (path.dirname(directory) === directory) return false
  }
}

/** The runner launch the bypass may replace: not one the folder's own install answers. */
function runnerLaunchOf(input: {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}) {
  const launch = parsePackageRunnerCommand(input.command, input.args, input.cwd)
  return launch && !installedNear(input.cwd, launch.packageName) ? launch : undefined
}

function isJavaScriptBin(file: string) {
  if (/\.[cm]?js$/u.test(file)) return true
  try {
    const head = readFileSync(file, { encoding: 'utf8', flag: 'r' }).slice(0, SHEBANG_BYTES)
    return head.startsWith('#!') && /\bnode\b/u.test(head.split('\n', 1)[0] ?? '')
  } catch {
    return false
  }
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
    const javascript = isJavaScriptBin(file)
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

export type PackageRunnerProbe = (input: {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}) => Promise<string>

const execProbe: PackageRunnerProbe = (input) =>
  new Promise((resolve, reject) => {
    execFile(
      input.command,
      [...input.args],
      {
        cwd: input.cwd,
        env: { ...input.env },
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_OUTPUT_BYTES,
        windowsHide: true,
        // `npx.cmd` on Windows.
        shell: process.platform === 'win32',
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })

const ResolvedPackageBinSchema = Schema.Struct({
  command: Schema.String,
  prefixArgs: Schema.Array(Schema.String),
  binDirectory: Schema.String,
  resolvedAt: Schema.Number,
  pinned: Schema.Boolean,
})
const StoredResolutionsSchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Record({ key: Schema.String, value: ResolvedPackageBinSchema }),
})
const ProbeOutputSchema = Schema.Struct({ path: Schema.String, node: Schema.String })

export interface PackageBinStore {
  readonly load: () => Record<string, ResolvedPackageBin>
  readonly save: (entries: Record<string, ResolvedPackageBin>) => void
}

/** A JSON file of resolutions, so a new Session Host does not start every server via its runner. */
export function fileBackedPackageBinStore(file: () => string): PackageBinStore {
  return {
    load: () => {
      let text: string
      try {
        text = readFileSync(file(), 'utf8')
      } catch {
        return {}
      }
      const stored = safeDecodeUnknown(StoredResolutionsSchema, readJson(text))
      return stored.success ? { ...stored.data.entries } : {}
    },
    save: (entries) => {
      try {
        mkdirSync(path.dirname(file()), { recursive: true })
        const stored = { version: 1, entries } satisfies typeof StoredResolutionsSchema.Type
        writeFileSync(file(), JSON.stringify(stored))
      } catch {
        // A resolution that is not saved is probed again by the next Host.
      }
    },
  }
}

export interface PackageRunnerBypassOptions {
  readonly store?: PackageBinStore
  readonly probe?: PackageRunnerProbe
  readonly now?: () => number
  readonly onProbeFailed?: (error: unknown, launch: PackageRunnerLaunch) => void
}

export interface StdioLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

/** Resolutions of package-runner launches, shared by every Session of the Host. */
export class PackageRunnerBypass {
  private entries: Record<string, ResolvedPackageBin> | undefined
  private readonly probing = new Map<string, Promise<void>>()
  private readonly probe: PackageRunnerProbe
  private readonly now: () => number

  constructor(private readonly options: PackageRunnerBypassOptions = {}) {
    this.probe = options.probe ?? execProbe
    this.now = options.now ?? Date.now
  }

  private key(launch: PackageRunnerLaunch, input: StdioLaunch) {
    // The PATH picks the runner and the `node` it runs. The folder does not, unless the package is
    // installed in its project, which `installedNear` leaves to the runner.
    return JSON.stringify([
      launch.runner,
      input.command,
      launch.packageSpec,
      launch.binName ?? null,
      input.env.PATH ?? '',
    ])
  }

  private cache() {
    this.entries ??= this.options.store?.load() ?? {}
    return this.entries
  }

  private fresh(entry: ResolvedPackageBin) {
    const ttl = entry.pinned ? PACKAGE_BIN_PINNED_TTL_MS : PACKAGE_BIN_UNPINNED_TTL_MS
    const age = this.now() - entry.resolvedAt
    if (age < 0 || age >= ttl) return false
    return existsSync(entry.command) && entry.prefixArgs.every((file) => existsSync(file))
  }

  /**
   * What to spawn for a configured stdio command. A runner launch with a fresh resolution spawns
   * the bin directly; otherwise the command runs as configured and, for a runner launch, a probe
   * resolves the bin for the next launch. `refresh` (Settings' check) always runs the runner and
   * probes again, so a tag such as `@latest` picks up a new version.
   */
  launch(input: StdioLaunch, options: { readonly refresh?: boolean } = {}): StdioLaunch {
    const launch = runnerLaunchOf(input)
    if (!launch) return input
    const key = this.key(launch, input)
    const entry = this.cache()[key]
    if (!options.refresh && entry && this.fresh(entry)) {
      const PATH = [entry.binDirectory, input.env.PATH].filter(Boolean).join(path.delimiter)
      return {
        ...input,
        command: entry.command,
        args: [...entry.prefixArgs, ...launch.serverArgs],
        env: { ...input.env, PATH },
      }
    }
    this.resolveInBackground(key, launch, input)
    return input
  }

  /**
   * Resolves a runner launch's bin before its first spawn, waiting at most `waitMs`: the probe
   * costs about what the runner's own start does, and then even a cold Hive's first servers start
   * without a runner beside them. A probe that takes longer keeps running for the next spawn.
   */
  async prepare(input: StdioLaunch, waitMs: number) {
    const launch = runnerLaunchOf(input)
    if (!launch) return
    const key = this.key(launch, input)
    const entry = this.cache()[key]
    if (entry && this.fresh(entry)) return
    this.resolveInBackground(key, launch, input)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.probing.get(key),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs)
      }),
    ])
    clearTimeout(timer)
  }

  /** Waits for every probe started so far (tests and measurement). */
  async settled() {
    await Promise.all(this.probing.values())
  }

  private resolveInBackground(key: string, launch: PackageRunnerLaunch, input: StdioLaunch) {
    if (this.probing.has(key)) return
    const probe = probeCommand(input.command, launch)
    const work = this.probe({ ...probe, cwd: input.cwd, env: input.env })
      .then(async (stdout) => {
        const parsed = safeDecodeUnknown(
          ProbeOutputSchema,
          readJson(stdout.trim().split('\n').at(-1) ?? ''),
        )
        if (!parsed.success) throw new Error('The package runner probe printed no PATH.')
        const resolved = await resolveBinFromProbe(parsed.data, launch, this.now())
        const entries = this.cache()
        if (resolved) entries[key] = resolved
        else delete entries[key]
        this.options.store?.save(entries)
      })
      .catch((error: unknown) => this.options.onProbeFailed?.(error, launch))
      .finally(() => this.probing.delete(key))
    this.probing.set(key, work)
  }
}
