import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
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
import { isRecord } from '@shared/utils/validation'
import { fromPartial } from '@total-typescript/shoehorn'
import { Type } from 'typebox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forOpenWaggleMcpSurface } from '../mcp-openwaggle-surface'

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
  return (await firstPrompt(extension, settled)).notices
}

/** Runs one prompt with the extension; the model answers with `responses`, in turn. */
async function firstPrompt(
  extension: ExtensionFactory,
  settled: (calls: readonly unknown[]) => boolean = () => true,
  responses = [fauxAssistantMessage('done')],
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ow-mcp-surface-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'quiet-provider', models: [{ id: 'quiet-model' }] })
  faux.setResponses(responses)
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
  return { notices: notify.mock.calls, session }
}

/** The text of every tool result the model was given in the Session. */
function toolResultTexts(session: { readonly messages: readonly unknown[] }) {
  return session.messages.flatMap((message) =>
    isRecord(message) && message.role === 'toolResult' && Array.isArray(message.content)
      ? message.content.flatMap((part: unknown) =>
          isRecord(part) && typeof part.text === 'string' ? [part.text] : [],
        )
      : [],
  )
}

describe("Pi's MCP extension in OpenWaggle", () => {
  it('does not notify that MCP servers are still connecting when a Session starts', async () => {
    // Pi's own extension does notify, so the wrapped one is checked against a real notice.
    const unwrapped = await noticesOfFirstPrompt(mcpExtension())
    expect(unwrapped).toContainEqual([expect.stringContaining('still connecting'), 'info'])

    const wrapped = await noticesOfFirstPrompt(forOpenWaggleMcpSurface(mcpExtension()))

    expect(wrapped).toEqual([])
  })

  it('tells the model to use Settings > MCP when a tool result says to run /mcp', async () => {
    // A tool that fails as Pi's MCP tools do when their server needs sign-in.
    const signInRequired = forOpenWaggleMcpSurface((pi) => {
      pi.registerTool({
        name: 'mcp__docs__search',
        label: 'search',
        description: 'Searches the docs.',
        parameters: Type.Object({}),
        execute: async () => {
          throw new Error('MCP server "docs" requires sign-in. Run /mcp to sign in.')
        },
      })
    })

    const { session } = await firstPrompt(signInRequired, () => true, [
      fauxAssistantMessage(fauxToolCall('mcp__docs__search', {})),
      fauxAssistantMessage('done'),
    ])

    expect(toolResultTexts(session)).toEqual([
      'MCP server "docs" requires sign-in. Sign in from Settings > MCP.',
    ])
  })

  it('still warns when an MCP server fails to connect, pointing at Settings > MCP', async () => {
    const notices = await noticesOfFirstPrompt(
      forOpenWaggleMcpSurface(mcpExtension('broken', BROKEN_SERVER)),
      (calls) => calls.length > 0,
    )

    expect(notices).toEqual([
      [
        expect.stringMatching(
          /^MCP servers need attention:\n {2}broken: [\s\S]*\nOpen Settings > MCP to fix this\.$/,
        ),
        'warning',
      ],
    ])
    expect(notices[0]?.[0]).not.toContain('/mcp')
  })
})
