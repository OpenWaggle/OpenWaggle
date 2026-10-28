import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The MCP setup of a heavy user, for memory and prefix measurements: six servers per Session as in
 * the v1 research (four started through `npx`). Chrome DevTools and Playwright are the real
 * packages at pinned versions; the hosted servers that need accounts (Atlassian, Figma, Datadog)
 * are a local fixture with the same tool counts and schema sizes.
 */
const FIXTURE_PACKAGE = path.join(import.meta.dirname, '..', 'fixtures', 'mcp-fixture-server')
const CHROME_DEVTOOLS_MCP = 'chrome-devtools-mcp@1.12.0'
const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.83'
const JSON_INDENT = 2
/**
 * Where the fixture `electron-devtools` server would attach: a privileged port nothing listens on.
 * Never 9223, the maintainer's `pnpm dev:debug` CDP port: a measured Run that called the tool
 * (`--setup maintainer` runs YOLO) would drive the maintainer's QA window. The server connects only
 * when a tool is called, so starting it, which is what the measurements count, is unaffected.
 */
export const FIXTURE_BROWSER_URL = 'http://127.0.0.1:1'

/** One npm cache for every measured profile, so the real servers download once. */
export const PERF_NPM_CACHE = path.join(os.tmpdir(), 'owperf-npm-cache')

function fixtureThroughNpx(toolset: string) {
  return { command: 'npx', args: ['-y', `file:${FIXTURE_PACKAGE}`, toolset] }
}

export function heavyUserGlobalMcpServers() {
  return {
    'chrome-devtools': { command: 'npx', args: ['-y', CHROME_DEVTOOLS_MCP], exposure: 'direct' },
    playwright: { command: 'npx', args: ['-y', PLAYWRIGHT_MCP], exposure: 'direct' },
    atlassian: { ...fixtureThroughNpx('atlassian'), exposure: 'direct' },
    figma: { ...fixtureThroughNpx('figma'), exposure: 'direct' },
    datadog: { command: 'node', args: [path.join(FIXTURE_PACKAGE, 'server.ts'), 'datadog'] },
  }
}

/** Writes the global MCP file into the profile's Pi agent directory and a project `.mcp.json`. */
export async function writeHeavyUserMcpConfig(input: { readonly agentDir: string; readonly projectPath: string }) {
  await mkdir(input.agentDir, { recursive: true })
  await writeFile(
    path.join(input.agentDir, 'mcp.json'),
    `${JSON.stringify({ mcpServers: heavyUserGlobalMcpServers() }, null, JSON_INDENT)}\n`,
  )
  const project = {
    mcpServers: {
      'electron-devtools': { command: 'npx', args: ['-y', CHROME_DEVTOOLS_MCP, `--browserUrl=${FIXTURE_BROWSER_URL}`] },
    },
  }
  await writeFile(path.join(input.projectPath, '.mcp.json'), `${JSON.stringify(project, null, JSON_INDENT)}\n`)
}

/** Environment for an app whose Runs use the heavy-user MCP setup. */
export const HEAVY_USER_MCP_ENVIRONMENT: Readonly<Record<string, string>> = {
  OPENWAGGLE_AUTOMATION_PROJECT_MCP: '1',
  npm_config_cache: PERF_NPM_CACHE,
  npm_config_update_notifier: 'false',
}
