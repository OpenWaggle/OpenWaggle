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
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { afterEach, expect, vi } from 'vitest'
import {
  resolveSessionRunExecution,
  type SessionRunExecutionProfileRow,
} from '../../session-run-execution-profile'
import {
  createAgentRunContextExtension,
  createAgentToolAllowlistGuard,
} from '../agent-run-context-extension'

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

/** The model's answer: text, or a tool call and then text. */
export type Reply =
  | 'answer'
  | { readonly tool: string; readonly input: Parameters<typeof fauxToolCall>[1] }
type RunKind = 'classic' | 'waggle' | 'command'

/** The custom message an extension command starts its turn with. */
export const COMMAND_MESSAGE_TYPE = 'qa.command'

/** Registers `/qa`, which starts a turn with a custom message, as extension commands do. */
const commandExtension: ExtensionFactory = (pi) => {
  pi.registerCommand('qa', {
    description: 'Start a turn from an extension command.',
    handler: async (args) => {
      pi.sendMessage(
        { customType: COMMAND_MESSAGE_TYPE, content: `Command: ${args}`, display: true },
        { triggerTurn: true },
      )
    },
  })
}

/** OpenWaggle Runs over one file-backed Pi session, each with a fresh runtime, as the Host runs them. */
export async function createHarness() {
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

  async function run(
    runId: string,
    kind: RunKind,
    prompt: string,
    reply: Reply,
    options: { readonly toolAllowlist?: readonly string[] } = {},
  ) {
    const execution = resolveSessionRunExecution(ROW, runId)
    const allowlist = options.toolAllowlist ? { toolAllowlist: options.toolAllowlist } : {}
    // First of the Run's inline extensions, as `classic-run.ts` loads it.
    const guard = createAgentToolAllowlistGuard(allowlist)
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      extensionFactories: [
        ...(guard ? [guard] : []),
        commandExtension,
        createAgentRunContextExtension({
          ...allowlist,
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
      tools: ['read', 'ls'],
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
                fauxToolCall(reply.tool, reply.input, { id: `${reply.tool}-${runId}` }),
                { stopReason: 'toolUse' },
              )
            },
            answer,
          ],
    )
    const requestsBefore = requests.length
    const expectedRequests = reply === 'answer' ? 1 : 2
    try {
      if (kind === 'classic') {
        await session.prompt(prompt)
        return
      }
      if (kind === 'command') {
        // `pi.sendMessage` does not wait for the turn it starts.
        await session.prompt(`/qa ${prompt}`)
        await vi.waitFor(() => expect(requests.length).toBe(requestsBefore + expectedRequests))
        await session.waitForIdle()
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

  return { run, requests, sessionFile: () => sessionFile }
}

/** The system prompt the provider receives, with every mid-conversation patch folded in. */
export function systemPrompt(context: TranscriptContext) {
  const leading = getInitialSystemMessage(collapseSystemMessages(context).messages)
  return leading ? getSystemMessageText(leading) : ''
}

export function conversation(context: Pick<TranscriptContext, 'messages'>) {
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
