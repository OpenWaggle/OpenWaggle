import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import {
  createPiWaggleTurnDetails,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { hydrateSessionMessage } from '../../../store/session-details/message-hydration'
import { projectPiSessionSnapshot } from '../agent-kernel/session-projection'
import { createAgentRunContextExtension } from '../agent-run-context-extension'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Turn 0 of a Waggle Run, as OpenWaggle runs it: the Run's context extension stores its Run
 * identity between the turn message and the turn's response. The file is then reopened, as a
 * reload does, and projected.
 */
async function reloadedWaggleTurn(response: AssistantMessage) {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-waggle-identity-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({
    provider: 'turn-provider',
    models: [{ id: 'turn-model', contextWindow: 100_000, maxTokens: 10_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'turn-key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [
      createAgentRunContextExtension({
        sessionIdentityContext: '- Hive role: Queen',
        runIdentityContext: '- Run: run-1',
      }),
    ],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await resourceLoader.reload()
  const sessionFile = SessionManager.create(directory, directory).getSessionFile()
  if (!sessionFile) throw new Error('Expected a file-backed Pi session')
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.open(sessionFile, directory),
    settingsManager,
    tools: [],
  })
  faux.setResponses([response])
  try {
    await session.sendCustomMessage(
      { customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE, content: 'Debate it', display: true },
      { triggerTurn: false },
    )
    await session.sendCustomMessage(
      {
        customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
        content: 'Turn 1 as Architect',
        display: false,
        details: createPiWaggleTurnDetails({
          runId: 'run-1',
          turnNumber: 0,
          agentIndex: 0,
          agentLabel: 'Architect',
          agentModel: 'turn-provider/turn-model',
          agentColor: 'blue',
        }),
      },
      { triggerTurn: true },
    )
    await session.waitForIdle()
  } finally {
    session.dispose()
  }

  const reloaded = SessionManager.open(sessionFile, directory)
  expect(reloaded.getEntries().map((entry) => entry.type)).toContain('custom')
  const snapshot = projectPiSessionSnapshot({ sessionManager: reloaded })
  const assistant = snapshot.nodes.find((node) => node.role === 'assistant')
  if (!assistant) throw new Error('Expected the turn response')
  return hydrateSessionMessage({
    id: assistant.id,
    session_id: 'session',
    parent_id: assistant.parentId,
    pi_entry_type: assistant.piEntryType,
    kind: assistant.kind,
    role: assistant.role,
    timestamp_ms: assistant.timestampMs,
    content_json: assistant.contentJson,
    metadata_json: assistant.metadataJson,
    branch_hint_id: null,
    path_depth: assistant.pathDepth,
    created_order: assistant.createdOrder,
  }).metadata
}

describe('the first turn of a reloaded Waggle Run', () => {
  it('keeps its Waggle metadata past the Run identity stored before its response', async () => {
    const metadata = await reloadedWaggleTurn(fauxAssistantMessage('Architect answer'))

    expect(metadata?.waggle).toMatchObject({ agentLabel: 'Architect', turnNumber: 0 })
  })

  it('keeps the error of a failed response, so the turn shows it after a refresh', async () => {
    const metadata = await reloadedWaggleTurn(
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: '401 Unauthorized' }),
    )

    expect(metadata).toMatchObject({
      error: '401 Unauthorized',
      waggle: { agentLabel: 'Architect', turnNumber: 0 },
    })
  })
})
