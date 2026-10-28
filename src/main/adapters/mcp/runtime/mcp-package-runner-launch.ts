/** How a package runner launch (`npx pkg args…`) is read, and how its bin is found (D1.2). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'

export type PackageRunner = 'npx' | 'npm-exec' | 'pnpm-dlx' | 'bunx'

/** A stdio server launched through a package runner. */
export interface PackageRunnerLaunch {
  readonly runner: PackageRunner
  /** The registry spec, such as `chrome-devtools-mcp@latest`. */
  readonly packageSpec: string
  /** The package name, such as `@playwright/mcp`. */
  readonly packageName: string
  /** The bin named after `--package <spec>`; otherwise the package's default bin. */
  readonly binName: string | undefined
  /** What follows the package or bin. */
  readonly serverArgs: readonly string[]
  /** An exact version: a resolution stays valid longer than for a tag or range. */
  readonly pinned: boolean
  /**
   * The absolute folder of a local `file:<dir>` spec. The spec is relative to the server's folder,
   * so the same spec names a different package in another folder (another project or worktree).
   */
  readonly localFolder?: string
}

const REGISTRY_SPEC =
  /^(?<name>(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*)(?:@(?<version>[^\s/:@]+))?$/iu
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u

function runnerOf(command: string, args: readonly string[]) {
  const base = path
    .basename(command)
    .toLowerCase()
    .replace(/\.(?:cmd|exe|bat)$/u, '')
  if (base === 'npx') return { runner: 'npx' as const, rest: args }
  if (base === 'npm' && (args[0] === 'exec' || args[0] === 'x')) {
    return { runner: 'npm-exec' as const, rest: args.slice(1) }
  }
  if (base === 'pnpm' && args[0] === 'dlx')
    return { runner: 'pnpm-dlx' as const, rest: args.slice(1) }
  if (base === 'bunx') return { runner: 'bunx' as const, rest: args }
  return undefined
}

/** Runner flags that do not change which bin runs or how. */
const PASSIVE_FLAGS: Readonly<Record<PackageRunner, ReadonlySet<string>>> = {
  npx: new Set(['-y', '--yes', '-q', '--quiet', '--silent', '--prefer-offline', '--prefer-online']),
  'npm-exec': new Set([
    '-y',
    '--yes',
    '-q',
    '--quiet',
    '--silent',
    '--prefer-offline',
    '--prefer-online',
  ]),
  'pnpm-dlx': new Set(['-s', '--silent']),
  // Not `--bun`: it runs even a `node` bin under Bun, which a direct spawn would not.
  bunx: new Set(['--silent']),
}

const PACKAGE_FLAGS = new Set(['-p', '--package'])

/** `flag=value` splits into its two parts. */
const FLAG_AND_VALUE_PARTS = 2

interface RunnerOptions {
  readonly packageSpec: string | undefined
  /** Index of the first argument after the runner's options. */
  readonly next: number
}

/**
 * The runner's own options: `--package <spec>` once, and flags that change nothing about the bin
 * that runs. Undefined for any other option, or several packages (the runner's PATH would hold
 * them all, which a direct spawn would not).
 */
function runnerOptions(runner: PackageRunner, rest: readonly string[]): RunnerOptions | undefined {
  let packageSpec: string | undefined
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? ''
    if (token === '--') return { packageSpec, next: index + 1 }
    if (!token.startsWith('-')) return { packageSpec, next: index }
    if (PASSIVE_FLAGS[runner].has(token)) continue
    const [flag, inline] = token.split('=', FLAG_AND_VALUE_PARTS)
    if (!flag || !PACKAGE_FLAGS.has(flag) || packageSpec !== undefined) return undefined
    packageSpec = inline ?? rest[++index]
    if (packageSpec === undefined) return undefined
  }
  return { packageSpec, next: rest.length }
}

/**
 * The package name of a spec: a registry spec names it; a local folder (`file:<dir>`) names it in
 * its `package.json`, found from the server's folder `cwd`.
 */
function packageNameOf(spec: string, cwd: string | undefined) {
  if (spec.startsWith('file:')) {
    if (cwd === undefined) return undefined
    const folder = path.resolve(cwd, spec.slice('file:'.length))
    try {
      const manifest: unknown = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'))
      if (typeof manifest !== 'object' || manifest === null || !('name' in manifest))
        return undefined
      return typeof manifest.name === 'string'
        ? { name: manifest.name, version: '', localFolder: folder }
        : undefined
    } catch {
      return undefined
    }
  }
  const parsed = REGISTRY_SPEC.exec(spec)
  const name = parsed?.groups?.name
  return name ? { name, version: parsed?.groups?.version ?? '' } : undefined
}

/**
 * The runner launch of a configured stdio command, or undefined when it is something else or uses
 * a form the bypass does not reproduce exactly (several packages, `-c`, git or tarball specs, …).
 * A `file:` folder is read from `cwd`.
 */
export function parsePackageRunnerCommand(
  command: string,
  args: readonly string[] = [],
  cwd?: string,
): PackageRunnerLaunch | undefined {
  const found = runnerOf(command, args)
  if (!found) return undefined
  const { runner, rest } = found
  const options = runnerOptions(runner, rest)
  const positional = options ? rest[options.next] : undefined
  if (!options || positional === undefined) return undefined
  const binName = options.packageSpec === undefined ? undefined : positional
  const spec = options.packageSpec ?? positional
  const named = packageNameOf(spec, cwd)
  if (!named || (binName !== undefined && !/^[\w.@~-]+$/u.test(binName))) return undefined
  return {
    runner,
    packageSpec: spec,
    packageName: named.name,
    binName,
    serverArgs: rest.slice(options.next + 1),
    pinned: EXACT_VERSION.test(named.version),
    ...('localFolder' in named ? { localFolder: named.localFolder } : {}),
  }
}

/** The bin npm runs for a package (`npm exec <pkg>`): the only one, or the one named after it. */
export function packageBinPath(
  packageJson: { readonly bin?: unknown },
  packageName: string,
  binName: string | undefined,
): string | undefined {
  const unscoped = packageName.replace(/^@[^/]+\//u, '')
  const { bin } = packageJson
  if (typeof bin === 'string')
    return binName === undefined || binName === unscoped ? bin : undefined
  if (typeof bin !== 'object' || bin === null) return undefined
  const entries = Object.entries(bin).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  if (binName !== undefined) return entries.find(([key]) => key === binName)?.[1]
  if (entries.length === 1) return entries[0]?.[1]
  return entries.find(([key]) => key === unscoped)?.[1]
}

/**
 * The probe prints the runner's PATH and the `node` it would run a JavaScript bin with. It holds
 * no space, quote, `|`, `&` or `^`, so it reaches node intact even through the `.cmd` shim of a
 * Windows runner, whose `%*` hands the arguments to `cmd.exe` once more.
 */
export const PROBE_SOURCE =
  "process.stdout.write(JSON.stringify({path:process.env.PATH??process.env.Path??'',node:process.execPath}))"

/** The runner command that prints what it puts on PATH for the package. */
export function probeCommand(command: string, launch: PackageRunnerLaunch) {
  const spec = launch.packageSpec
  const probe = ['node', '-e', PROBE_SOURCE]
  return match(launch.runner)
    .with('npx', () => ({ command, args: ['--yes', `--package=${spec}`, '--', ...probe] }))
    .with('npm-exec', () => ({
      command,
      args: ['exec', '--yes', `--package=${spec}`, '--', ...probe],
    }))
    .with('pnpm-dlx', () => ({ command, args: [`--package=${spec}`, 'dlx', ...probe] }))
    .with('bunx', () => ({ command, args: ['--package', spec, ...probe] }))
    .exhaustive()
}

/** Characters `cmd.exe` reads as syntax, escaped with `^` as cross-spawn does. */
const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu
/** An npm cmd-shim re-reads its arguments through `cmd.exe`, so they are escaped twice. */
const NPM_CMD_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/iu

function cmdEscapedArgument(argument: string, twice: boolean) {
  // Backslashes before a quote, or at the end (before the closing quote), are doubled, and the
  // quote itself escaped, as the C runtime of the program parses its command line.
  const quoted = `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`
  const escaped = quoted.replace(CMD_META_CHARACTERS, '^$1')
  return twice ? escaped.replace(CMD_META_CHARACTERS, '^$1') : escaped
}

/**
 * The `cmd.exe /d /s /c "…"` command line that runs a Windows runner (`npx.cmd`, `pnpm.cmd`) with
 * exactly these arguments. Node's `shell: true` joins arguments unquoted, so `cmd.exe` split the
 * probe at `||` and the probe never worked on Windows (review R5 P1-2).
 */
export function windowsCommandLine(command: string, args: readonly string[]) {
  const twice = NPM_CMD_SHIM.test(command)
  // The program in plain quotes, which `cmd.exe` keeps (a path cannot hold a quote): an absolute
  // `C:\Program Files\nodejs\npx.cmd` stays one word.
  const line = [
    `"${path.win32.normalize(command)}"`,
    ...args.map((argument) => cmdEscapedArgument(argument, twice)),
  ].join(' ')
  return `"${line}"`
}
