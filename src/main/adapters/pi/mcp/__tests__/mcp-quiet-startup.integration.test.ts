import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionFactory,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withoutMcpStartupNotice } from '../mcp-quiet-startup'

/** A stdio MCP server that never answers, so it is still connecting when the prompt starts. */
const SILENT_SERVER = "require('node:readline').createInterface({ input: process.stdin })"
/** A stdio MCP server that exits before answering, so it fails to connect. */
const BROKEN_SERVER = 'process.exit(1)'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function mcpExtension(name = 'slow', script = SILENT_SERVER): ExtensionFactory {
  return createMcpExtension({
    loadConfig: () => ({
      servers: [
        {
          name,
          config: { command: process.execPath, args: ['-e', script], exposure: 'direct' },
          source: 'test',
          scope: 'global',
        },
      ],
      errors: [],
    }),
    startupWaitMs: 50,
  })
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Runs one prompt with the extension and returns the notices, once `settled` holds for them (the
 * Session stays open until then, as a Run's does while it runs).
 */
async function noticesOfFirstPrompt(
  extension: ExtensionFactory,
  settled: (calls: readonly unknown[]) => boolean = () => true,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ow-mcp-quiet-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'quiet-provider', models: [{ id: 'quiet-model' }] })
  faux.setResponses([fauxAssistantMessage('done')])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [extension],
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager,
  })
  // `dispose()` does not emit `session_shutdown`, where Pi's MCP extension closes its servers, so
  // emit it as a Run's end does; otherwise the server process outlives the test.
  cleanups.push(async () => {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  })
  const notify = vi.fn<ExtensionUIContext['notify']>()
  await session.bindExtensions({ uiContext: fromPartial<ExtensionUIContext>({ notify }) })
  await session.prompt('Hello.')
  await waitUntil(() => settled(notify.mock.calls))
  return notify.mock.calls
}

describe("Pi's MCP extension in OpenWaggle", () => {
  it('does not notify that MCP servers are still connecting when a Session starts', async () => {
    // Pi's own extension does notify, so the wrapped one is checked against a real notice.
    const unwrapped = await noticesOfFirstPrompt(mcpExtension())
    expect(unwrapped).toContainEqual([expect.stringContaining('still connecting'), 'info'])

    const wrapped = await noticesOfFirstPrompt(withoutMcpStartupNotice(mcpExtension()))

    expect(wrapped).toEqual([])
  })

  it('still warns when an MCP server fails to connect', async () => {
    const notices = await noticesOfFirstPrompt(
      withoutMcpStartupNotice(mcpExtension('broken', BROKEN_SERVER)),
      (calls) => calls.length > 0,
    )

    expect(notices).toEqual([
      [expect.stringMatching(/MCP servers need attention:\n {2}broken: /), 'warning'],
    ])
  })
})
