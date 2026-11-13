/**
 * `bun run dev` and `bun run dev:debug`: the desktop app from this checkout under Electrobun
 * (ADR 0064). It builds main, preload and renderer (`bun run build`) and stages them the way a
 * package does (scripts/electrobun/stage.ts). `dev` then runs `electrobun dev` through Hutch, which
 * builds a `dev` app into `out/electrobun/build` and starts it with this process's output.
 *
 * A dev build carries copies of the checkout's build, so rerun the command after an edit; there is
 * no renderer hot reload. `OPENWAGGLE_HUTCH` picks the Hutch command (`bun x electrobun` by default,
 * scripts/electrobun/package.ts).
 *
 *   bun scripts/electrobun/dev.ts [--debug] [--skip-build]
 *
 * `--debug` builds the same `dev` app and starts it the way agents drive it (the electron-qa skill,
 * scripts/support/electrobun-app-launch.ts): hidden, in automation mode, on a scratch profile under
 * TMPDIR, with the main window rendered by CEF and its DevTools endpoint on port 9223. Ctrl-C stops
 * the app and its Session Host and removes the profile.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { stopQaProfileSessionHost } from '../qa/session-host-shutdown'
import {
  DEV_DEBUG_CDP_PORT,
  resolveElectrobunLauncher,
  startElectrobunApp,
  stopElectrobunApp,
  waitForRendererTarget,
} from '../support/electrobun-app-launch'
import { ELECTROBUN_BUILD_DIR } from './app-config'
import { hutchCommand } from './package'
import { stageElectrobunApp } from './stage'

const FIRST_CLI_ARGUMENT = 2
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const RENDERER_TIMEOUT_MS = 120_000
const AUTOMATION_OPTION_PREFIX = 'OPENWAGGLE_AUTOMATION_'
const ELECTROBUN_OS: Readonly<Record<string, string>> = { darwin: 'macos', win32: 'win' }

interface DevOptions {
  readonly debug: boolean
  readonly skipBuild: boolean
}

export function parseDevArguments(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      debug: { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
    },
  })
  return { debug: values.debug, skipBuild: values['skip-build'] }
}

/** The Hutch invocation for `electrobun <command>` in the dev build environment. */
export function hutchDevInvocation(environment: NodeJS.ProcessEnv, command: 'build' | 'dev') {
  const [executable = process.execPath, ...prefix] = hutchCommand(environment)
  return { executable, args: [...prefix, command, '--env=dev'] }
}

/** Where Hutch puts the dev app: `out/electrobun/build/dev-<os>-<arch>/<app>`. */
export function devBuildDirectory(
  root: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
) {
  const os = ELECTROBUN_OS[platform] ?? 'linux'
  return path.join(root, ELECTROBUN_BUILD_DIR, `dev-${os}-${arch}`)
}

async function devApp(root: string) {
  const directory = devBuildDirectory(root)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const app = entries.find((entry) => entry.isDirectory())
  if (app === undefined) throw new Error(`Hutch built no dev app in ${directory}.`)
  return path.join(directory, app.name)
}

/**
 * The caller's `OPENWAGGLE_AUTOMATION_*` options (first-party extensions, fixture Pi extensions,
 * project MCP servers), which the launch's safe environment would drop, and this checkout as the
 * profile's project, with no fabricated Sessions.
 */
export function automationOptions(environment: NodeJS.ProcessEnv, projectPath: string) {
  const options: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment)) {
    if (key.startsWith(AUTOMATION_OPTION_PREFIX) && value !== undefined) options[key] = value
  }
  return { ...options, OPENWAGGLE_AUTOMATION_PROJECT_PATH: projectPath }
}

function exitCode(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal === null ? 0 : 1)))
  })
}

async function runDev() {
  const { executable, args } = hutchDevInvocation(process.env, 'dev')
  const child = spawn(executable, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
  const forward = (signal: NodeJS.Signals) => child.kill(signal)
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  return exitCode(child)
}

async function runDebug() {
  const { executable, args } = hutchDevInvocation(process.env, 'build')
  execFileSync(executable, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
  const launcher = await resolveElectrobunLauncher(await devApp(ROOT))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-dev-debug-'))
  const userDataDir = path.join(root, 'user-data')
  const app = await startElectrobunApp({
    launcher,
    userDataDir,
    homeDir: path.join(root, 'home'),
    cdpPort: DEV_DEBUG_CDP_PORT,
    cwd: ROOT,
    environment: automationOptions(process.env, ROOT),
    onLine: (line) => console.info(line),
  })
  const stop = () => void stopElectrobunApp(app)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const exited = exitCode(app.child)
  try {
    await waitForRendererTarget(app, RENDERER_TIMEOUT_MS)
    console.info(`[dev:debug] scratch profile ${root}`)
    console.info(`[dev:debug] CDP http://127.0.0.1:${String(DEV_DEBUG_CDP_PORT)}/json/list`)
    return await exited
  } finally {
    await stopElectrobunApp(app)
    await stopQaProfileSessionHost(userDataDir).then(
      () => fs.rm(root, { recursive: true, force: true }),
      (error: unknown) =>
        console.error(`[dev:debug] Session Host did not stop; kept ${root}`, error),
    )
  }
}

async function main(options: DevOptions) {
  if (!options.skipBuild) {
    execFileSync(process.execPath, ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  }
  await stageElectrobunApp({
    root: ROOT,
    target: { platform: process.platform, arch: process.arch },
    webview2: null,
    allowMissingResources: false,
    environment: process.env,
  })
  return options.debug ? runDebug() : runDev()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(parseDevArguments(process.argv.slice(FIRST_CLI_ARGUMENT))).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
