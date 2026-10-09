import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  collapseSystemMessages,
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getInitialSystemMessage,
  getSystemMessageText,
  InMemoryCredentialStore,
  type Message,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveSessionRunExecution,
  type SessionRunExecutionProfileRow,
} from '../../session-run-execution-profile'
import { createAgentRunContextExtension } from '../agent-run-context-extension'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const ROW: SessionRunExecutionProfileRow = {
  session_id: 'queen-1',
  title: 'Debate the design',
  project_path: '/repo',
  profile_json: JSON.stringify({ modelId: 'turn-provider/turn-model', thinkingLevel: 'off' }),
  resolved_agent_snapshot_json: JSON.stringify({
    schemaVersion: 1,
    name: 'reviewer',
    description: 'Reviews changes.',
    instructions: 'Review the implementation.',
    scope: 'project',
    sourcePath: '/repo/.openwaggle/agents/reviewer.md',
    contentDigest: '0'.repeat(64),
  }),
  authorization_ceiling: 'ask-for-approval',
  parent_session_id: null,
  parent_title: null,
  hive_root_session_id: 'queen-1',
  depth: 0,
  direct_worker_count: 0,
  workspace_id: 'workspace-1',
  workspace_kind: 'local',
  working_path: '/repo',
  capabilities_json: JSON.stringify(['sessions:read']),
  delegation_id: null,
  delegation_state: null,
}

type Reply = 'read-then-answer' | 'answer'

/** OpenWaggle Runs over one file-backed Pi session, each with a fresh runtime, as the Host runs them. */
async function createHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-waggle-turn-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(path.join(directory, 'notes.txt'), 'notes\n')
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
  const created = SessionManager.create(directory, directory).getSessionFile()
  if (!created) throw new Error('Expected a file-backed Pi session')
  const sessionFile: string = created
  const requests: TranscriptContext[] = []

  async function run(runId: string, kind: 'classic' | 'waggle', prompt: string, reply: Reply) {
    const execution = resolveSessionRunExecution(ROW, runId)
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      extensionFactories: [
        createAgentRunContextExtension({
          sessionIdentityContext: execution.identityContext,
          runIdentityContext: execution.runIdentityContext,
          ...(execution.agentInstructions
            ? { agentInstructions: execution.agentInstructions }
            : {}),
        }),
      ],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    })
    await resourceLoader.reload()
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: faux.getModel(),
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.open(sessionFile, directory),
      settingsManager,
      tools: ['read'],
    })
    const answer = (context: TranscriptContext) => {
      requests.push(context)
      return fauxAssistantMessage(`answer for ${runId}`)
    }
    faux.setResponses(
      reply === 'answer'
        ? [answer]
        : [
            (context) => {
              requests.push(context)
              return fauxAssistantMessage(
                fauxToolCall('read', { path: 'notes.txt' }, { id: `read-${runId}` }),
                {
                  stopReason: 'toolUse',
                },
              )
            },
            answer,
          ],
    )
    try {
      if (kind === 'classic') {
        await session.prompt(prompt)
        return
      }
      // As `sendInitialWaggleMessages` starts a Waggle Run.
      await session.sendCustomMessage(
        { customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE, content: prompt, display: true },
        { triggerTurn: false },
      )
      await session.sendCustomMessage(
        { customType: PI_WAGGLE_TURN_CUSTOM_TYPE, content: `Turn: ${prompt}`, display: false },
        { triggerTurn: true },
      )
    } finally {
      session.dispose()
    }
  }

  return { run, requests }
}

/** The system prompt the provider receives, with every mid-conversation patch folded in. */
function systemPrompt(context: TranscriptContext) {
  const leading = getInitialSystemMessage(collapseSystemMessages(context).messages)
  return leading ? getSystemMessageText(leading) : ''
}

function conversation(context: Pick<TranscriptContext, 'messages'>) {
  return context.messages
    .filter((message) => message.role !== 'system')
    .map((message: Message) =>
      message.role === 'assistant'
        ? JSON.stringify(message.content)
        : message.role === 'toolResult'
          ? JSON.stringify(message.content)
          : contentText(message.content),
    )
    .join('\n\n')
}

function expectFullSystemPrompt(context: TranscriptContext) {
  const prompt = systemPrompt(context)
  expect(prompt).toContain('<tools>')
  expect(prompt).toContain('OpenWaggle Session identity (Host-authored)')
  expect(prompt).toContain('Review the implementation.')
}

describe('a Waggle Run started with custom messages', () => {
  it("sends Pi's and OpenWaggle's prompt sections from the first request of a Waggle-first Session, through a tool call", async () => {
    const harness = await createHarness()

    await harness.run('run-waggle', 'waggle', 'Debate it', 'read-then-answer')

    const [beforeTool, afterTool] = harness.requests
    if (!beforeTool || !afterTool)
      throw new Error('Expected a request before and after the tool call')
    expectFullSystemPrompt(beforeTool)
    expectFullSystemPrompt(afterTool)
    expect(systemPrompt(afterTool)).toBe(systemPrompt(beforeTool))
    expect(conversation(afterTool).startsWith(conversation(beforeTool))).toBe(true)
    expect(conversation(beforeTool)).toContain('"runId": "run-waggle"')
  })

  it('keeps every Run its own identity and the earlier request as a prefix in a classic-then-Waggle Session', async () => {
    const harness = await createHarness()

    await harness.run('run-classic', 'classic', 'Audit it', 'answer')
    await harness.run('run-waggle', 'waggle', 'Debate it', 'read-then-answer')
    await harness.run('run-next', 'classic', 'Summarize', 'answer')

    const texts = harness.requests.map(conversation)
    harness.requests.forEach((request, index) => {
      expectFullSystemPrompt(request)
      if (index > 0) expect(texts[index]?.startsWith(texts[index - 1] ?? '')).toBe(true)
    })
    expect(texts.at(-1)).toContain('"runId": "run-classic"')
    expect(texts.at(-1)).toContain('"runId": "run-waggle"')
    expect(texts.at(-1)).toContain('"runId": "run-next"')
    expect(texts.at(-1)?.split('"runId": "run-waggle"')).toHaveLength(2)
  })
})
