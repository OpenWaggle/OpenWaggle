import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  collapseSystemMessages,
  contentText,
  fauxAssistantMessage,
  fauxProvider,
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
import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
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

function workerRow(
  overrides: Partial<SessionRunExecutionProfileRow> = {},
): SessionRunExecutionProfileRow {
  return {
    session_id: 'worker-1',
    title: 'Audit runtime',
    project_path: '/repo',
    profile_json: JSON.stringify({ modelId: 'cache-provider/cache-model', thinkingLevel: 'high' }),
    resolved_agent_snapshot_json: JSON.stringify({
      schemaVersion: 1,
      name: 'reviewer',
      description: 'Reviews implementation changes.',
      instructions: 'Review the implementation.',
      scope: 'project',
      sourcePath: '/repo/.openwaggle/agents/reviewer.md',
      contentDigest: '0'.repeat(64),
    }),
    authorization_ceiling: 'ask-for-approval',
    parent_session_id: 'queen-1',
    parent_title: 'Implement orchestration',
    hive_root_session_id: 'queen-1',
    depth: 1,
    direct_worker_count: 0,
    workspace_id: 'workspace-1',
    workspace_kind: 'managed-worktree',
    working_path: '/repo/.worktrees/worker-1',
    capabilities_json: JSON.stringify(['sessions:read', 'sessions:report']),
    delegation_id: 'delegation-1',
    delegation_state: 'working',
    ...overrides,
  }
}

async function createSessionHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-prompt-cache-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({
    provider: 'cache-provider',
    models: [{ id: 'cache-model', contextWindow: 100_000, maxTokens: 10_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'cache-key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const sessionManager = SessionManager.inMemory(directory)
  const requests: TranscriptContext[] = []

  /** One OpenWaggle Run: a fresh Pi runtime over the same Session transcript. */
  async function run(
    runId: string,
    prompts: string | readonly string[],
    rowOverrides: Partial<SessionRunExecutionProfileRow> = {},
    options: { readonly waggle?: boolean } = {},
  ) {
    const execution = resolveSessionRunExecution(workerRow(rowOverrides), runId)
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
      sessionManager,
      settingsManager,
      noTools: 'all',
    })
    const runPrompts = typeof prompts === 'string' ? [prompts] : prompts
    faux.setResponses(
      runPrompts.map(() => (context) => {
        requests.push(context)
        return fauxAssistantMessage(`answer for ${runId}`)
      }),
    )
    try {
      for (const prompt of runPrompts) {
        // A Waggle Run is prompted with custom messages (`waggle-run-messages.ts`).
        if (options.waggle) {
          await session.sendCustomMessage(
            { customType: PI_WAGGLE_TURN_CUSTOM_TYPE, content: prompt, display: false },
            { triggerTurn: true },
          )
        } else {
          await session.prompt(prompt)
        }
      }
    } finally {
      session.dispose()
    }
  }

  return { run, requests, sessionManager }
}

function leadingSystemPrompt(context: Pick<TranscriptContext, 'messages'>) {
  const leading = getInitialSystemMessage(context.messages)
  if (!leading) throw new Error('The provider request has no leading system message')
  return getSystemMessageText(leading)
}

/** The leading prompt a provider without mid-conversation system messages receives. */
function collapsedLeadingSystemPrompt(context: TranscriptContext) {
  return leadingSystemPrompt(collapseSystemMessages(context))
}

function nonSystemText(context: Pick<TranscriptContext, 'messages'>) {
  return context.messages
    .filter((message) => message.role !== 'system')
    .map((message: Message) =>
      message.role === 'assistant'
        ? message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
        : contentText(message.content),
    )
    .join('\n\n')
}

describe('Agent run context and the provider prompt cache', () => {
  it('keeps the leading system prompt byte-stable across Runs while each runId reaches the model', async () => {
    const harness = await createSessionHarness()

    await harness.run('run-first', 'Audit the adapter')
    // Session state that changes between Runs (title, Workers, Delegation state) must not
    // reach the leading prompt either.
    await harness.run('run-second', 'Now audit the projection', {
      title: 'Audit runtime and projection',
      direct_worker_count: 2,
      delegation_state: 'revision_requested',
    })

    const [first, second] = harness.requests
    if (!first || !second) throw new Error('Expected one provider request per Run')

    expect(leadingSystemPrompt(second)).toBe(leadingSystemPrompt(first))
    expect(collapsedLeadingSystemPrompt(second)).toBe(collapsedLeadingSystemPrompt(first))

    const leading = leadingSystemPrompt(second)
    expect(leading).toContain('OpenWaggle Session identity (Host-authored)')
    expect(leading).toContain('authoritative')
    expect(leading).toContain('"sessionId": "worker-1"')
    expect(leading).toContain('Review the implementation.')
    expect(leading).not.toContain('run-first')
    expect(leading).not.toContain('run-second')

    expect(nonSystemText(first)).toContain('"runId": "run-first"')
    const secondRunContext = nonSystemText(second)
    expect(secondRunContext).toContain('OpenWaggle Host-authored Run identity')
    expect(secondRunContext).toContain('"runId": "run-second"')
    expect(secondRunContext).toContain('"sessionTitle": "Audit runtime and projection"')
    expect(secondRunContext).toContain('"delegationState": "revision_requested"')
  })

  it('sends the Run identity once per Run, not on every prompt of the same Run', async () => {
    const harness = await createSessionHarness()

    await harness.run('run-only', ['Audit the adapter', 'Continue the audit'])

    const last = harness.requests.at(-1)
    if (!last) throw new Error('Expected provider requests')
    expect(nonSystemText(last).split('"runId": "run-only"')).toHaveLength(2)
  })

  it("keeps the Run identity out of the context Pi builds from the Session's file", async () => {
    const harness = await createSessionHarness()

    await harness.run('run-first', 'Audit the adapter')
    await harness.run('run-second', 'Now audit the projection')

    // `pi --resume` sends what the file holds; the Run identity is OpenWaggle's alone.
    const piContext = { messages: harness.sessionManager.buildSessionContext().messages }
    expect(piContext.messages.some((message) => message.role === 'custom')).toBe(false)
    expect(JSON.stringify(piContext.messages)).not.toContain(
      'OpenWaggle Host-authored Run identity',
    )
    // OpenWaggle's Runs still send each Run's identity where it was first sent, so the
    // provider prompt cache keeps the earlier Run's prefix.
    const [first, second] = harness.requests
    if (!first || !second) throw new Error('Expected one provider request per Run')
    expect(nonSystemText(second).startsWith(nonSystemText(first))).toBe(true)
    expect(nonSystemText(second)).toContain('"runId": "run-first"')
    expect(nonSystemText(second)).toContain('"runId": "run-second"')
  })

  it.each([
    ['a Waggle-only Session', ['waggle', 'waggle']],
    ['a mixed Session', ['classic', 'waggle', 'classic']],
  ] as const)(
    'sends a Waggle Run its identity after its own prompt in %s',
    async (_label, kinds) => {
      const harness = await createSessionHarness()

      for (const [index, kind] of kinds.entries()) {
        await harness.run(`run-${index}`, `Prompt ${index}`, {}, { waggle: kind === 'waggle' })
      }

      const texts = harness.requests.map(nonSystemText)
      texts.forEach((text, index) => {
        expect(text).toContain(`Prompt ${index}\n\nOpenWaggle Host-authored Run identity`)
        expect(text).toContain(`"runId": "run-${index}"`)
        // Each request keeps the one before it as its prefix, so its prompt cache holds.
        if (index > 0) expect(text.startsWith(texts[index - 1] ?? '')).toBe(true)
      })
    },
  )
})
