/**
 * Proves a packaged Electrobun build of OpenWaggle on a CI runner
 * (.github/workflows/electrobun-package.yml): installs it the way a user does, launches the real app
 * hidden, drives it over CEF's DevTools endpoint and its CLI, and updates it through its own update
 * engine from a newer build on a local feed. Throwaway machines only (installed-app.ts).
 *
 *   bun scripts/electrobun/ci/smoke.ts install <release dir>
 *     macOS: the DMG's app into /Applications; Windows: the NSIS installer, silently; Linux: the
 *     AppImage, whose AppRun runs Electrobun's installer. Prints the installed launcher.
 *   bun scripts/electrobun/ci/smoke.ts launch <launcher> --expect <version> --profile <dir>
 *     --out <json> [--screenshots <dir>] [--prove] [--open-session <id>] [--timeout <s>]
 *     Starts the app hidden (OPENWAGGLE_AUTOMATION=1, the main window on CEF, a scratch HOME and
 *     userData under <dir>), waits for startup status `ready` and checks the version. `--prove`
 *     then starts the Session Host, runs one turn against a local fake provider through
 *     `openwaggle run`, opens a terminal and a Browser preview (app-proof.ts). `--open-session`
 *     launches with that Session's `openwaggle://` link and checks the window opened it.
 *     Records spawn-to-renderer and spawn-to-ready times and, after the app idled, the resident
 *     memory of its process tree.
 *   bun scripts/electrobun/ci/smoke.ts update <launcher> --from <version> --expect <version>
 *     --feed <url> --profile <dir> --out <json> [--screenshots <dir>] [--timeout <s>]
 *     Launches the app with its updater pointed at the loopback release directory <url>
 *     (OPENWAGGLE_AUTOMATION_UPDATE_FEED, src/main/update-feed-automation.ts), checks, waits for
 *     the download, presses Restart to update, then launches the installed app again and checks it
 *     is <expect>.
 *   bun scripts/electrobun/ci/smoke.ts serve <directory> <port>
 *     Serves a release directory over loopback HTTP, which Electrobun's updater allows.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FAKE_MODEL_REFERENCE, configureFakeProvider } from '../../perf/lib/fake-openai-provider'
import { appRss, directoryBytes } from '../../electrobun-probe-host'
import { type ConnectedElectrobunApp, electrobunAppHome } from '../../support/electrobun-app-launch'
import { appCli, type LaunchContext, startApp, stopApp } from './app-launch'
import {
  createProject,
  proveBrowserPreview,
  proveFakeProviderRun,
  proveSessionHost,
  proveTerminal,
  screenshot,
  startCiFakeProvider,
  waitUntil,
} from './app-proof'
import { install, installedApp, processesUnder } from './installed-app'
import { proveUpdate } from './update-proof'

const FIRST_CLI_ARGUMENT = 2
const COMMAND_OPTIONS_OFFSET = 2
const IDLE_MS = 10_000
const DEFAULT_TIMEOUT_S = 240
const MS_PER_SECOND = 1000
const JSON_INDENT = 2
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404

function step(message: string) {
  console.log(`smoke: ${message}`)
}

async function prove(context: LaunchContext, app: ConnectedElectrobunApp) {
  const cli = appCli(context, app.cdpPort)
  const sessionHost = await proveSessionHost(cli)
  step('the Session Host started')
  const project = await createProject(path.join(context.profile, 'project'))
  const run = await proveFakeProviderRun({
    cli,
    page: app.page,
    project,
    model: FAKE_MODEL_REFERENCE,
    timeoutMs: context.timeoutMs,
  })
  step(`the fake-provider Run finished in Session ${run.sessionId}`)
  const sessionShot = await screenshot(app.page, context.screenshots, 'session-after-run.png')
  const terminal = await proveTerminal(app.page, context.timeoutMs)
  step('the terminal echoed')
  const terminalShot = await screenshot(app.page, context.screenshots, 'terminal.png')
  const preview = await proveBrowserPreview({
    app,
    sessionId: run.sessionId,
    screenshots: context.screenshots,
    timeoutMs: context.timeoutMs,
  })
  step('the Browser preview is a DevTools target')
  return { sessionHost, run, terminal, preview, screenshots: [sessionShot, terminalShot] }
}

async function openedSession(
  context: LaunchContext,
  app: ConnectedElectrobunApp,
  sessionId: string,
) {
  try {
    await waitUntil('the window to open the Session link', context.timeoutMs, () =>
      app.page.evaluate((id) => window.location.href.includes(id), sessionId),
    )
  } catch (error) {
    // Whether the launcher handed the link to the main process (vendor/electrobun patch 0006).
    const commands = processesUnder(context.app.installRoot).map((row) => row.command)
    throw new Error(`${String(error)}\nProcesses of the install:\n${commands.join('\n')}`, {
      cause: error,
    })
  }
  return { sessionId, url: app.page.url() }
}

async function launch(
  context: LaunchContext,
  options: {
    readonly expect: string
    readonly prove: boolean
    readonly openSession: string | null
  },
) {
  const provider = await startCiFakeProvider()
  await configureFakeProvider(
    electrobunAppHome({ userDataDir: context.profile }).piAgentDir,
    provider.baseUrl,
  )
  const launchContext: LaunchContext =
    options.openSession === null
      ? context
      : { ...context, appArguments: [`openwaggle://sessions/${options.openSession}`] }
  const { app, spawnToRendererMs, spawnToReadyMs } = await startApp(launchContext)
  step(`startup status ready after ${String(spawnToReadyMs)} ms`)
  try {
    const version = await app.page.evaluate(async () => window.api.getAppVersion())
    if (version !== options.expect) throw new Error(`The app is ${version}, not ${options.expect}.`)
    const startup = await screenshot(app.page, context.screenshots, 'startup-ready.png')
    const sessionLink =
      options.openSession === null ? null : await openedSession(context, app, options.openSession)
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
    const idleRssBytes = app.child.pid === undefined ? 0 : appRss(app.child.pid)
    const proof = options.prove ? await prove(context, app) : null
    return { version, spawnToRendererMs, spawnToReadyMs, idleRssBytes, startup, sessionLink, proof }
  } finally {
    await stopApp(context, app)
    step('stopped the app')
    await provider.close()
  }
}

function serve(directory: string, port: number) {
  http
    .createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      const file = path.join(directory, path.normalize(name))
      if (!file.startsWith(directory) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(HTTP_NOT_FOUND).end()
        return
      }
      response.writeHead(HTTP_OK, { 'content-length': fs.statSync(file).size })
      fs.createReadStream(file).pipe(response)
    })
    .listen(port, '127.0.0.1')
}

function commandOptions(argv: readonly string[]) {
  const { values } = parseArgs({
    args: argv.slice(COMMAND_OPTIONS_OFFSET),
    options: {
      expect: { type: 'string' },
      from: { type: 'string' },
      feed: { type: 'string' },
      profile: { type: 'string' },
      out: { type: 'string' },
      screenshots: { type: 'string' },
      prove: { type: 'boolean', default: false },
      'open-session': { type: 'string' },
      timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_S) },
    },
  })
  if (values.expect === undefined || values.out === undefined || values.profile === undefined) {
    throw new Error('launch and update need --expect, --profile and --out')
  }
  return { ...values, expect: values.expect, out: values.out, profile: values.profile }
}

async function main(argv: readonly string[]) {
  const [command, first, second] = argv
  if (command === 'install' && first !== undefined) {
    const { app, stoppedAfterInstall } = await install(path.resolve(first))
    const installedBytes = directoryBytes(app.installRoot)
    console.log(JSON.stringify({ launcher: app.launcher, installedBytes, stoppedAfterInstall }))
    return
  }
  if (command === 'serve' && first !== undefined && second !== undefined) {
    serve(path.resolve(first), Number(second))
    return
  }
  if ((command !== 'launch' && command !== 'update') || first === undefined) {
    throw new Error('Usage: see the file header.')
  }
  const options = commandOptions(argv)
  fs.mkdirSync(options.profile, { recursive: true })
  const context: LaunchContext = {
    app: installedApp(path.resolve(first)),
    profile: path.resolve(options.profile),
    screenshots: options.screenshots === undefined ? null : path.resolve(options.screenshots),
    timeoutMs: Number(options.timeout) * MS_PER_SECOND,
  }
  const result =
    command === 'launch'
      ? await launch(context, {
          expect: options.expect,
          prove: options.prove,
          openSession: options['open-session'] ?? null,
        })
      : await proveUpdate(context, {
          from: options.from ?? '',
          expect: options.expect,
          feed: options.feed ?? '',
        })
  fs.writeFileSync(options.out, `${JSON.stringify(result, null, JSON_INDENT)}\n`)
  console.log(JSON.stringify(result))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_CLI_ARGUMENT)).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error)
      process.exit(1)
    },
  )
}
