import { SessionId } from '@shared/types/brand'
import { McpSessionConnectionPool } from '../../../src/main/adapters/mcp/pool/mcp-session-connection-pool'
import { createPiSessionForRun } from '../../../src/main/adapters/pi/agent-kernel/pi-run-session'
import { openWaggleMcpConnectionHooks } from '../../../src/main/adapters/pi/mcp/mcp-session-context'
import { createPiRuntimeServices } from '../../../src/main/adapters/pi/pi-provider-catalog'
import { disposeOpenWagglePiSession } from '../../../src/main/adapters/pi/pi-session-lifecycle'
import type { PrefixContent } from './prefix-tokens'
import { composeFirstTurnRun } from './run-composition'
import type { PrefixSessionRole } from './session-identity-rows'

/** Paths the packaged app names in a Run's prompt; fixed so the count does not depend on the machine. */
const PACKAGED_DOCS_BUNDLE_PATH = '/Applications/OpenWaggle.app/Contents/Resources/openwaggle-docs'
const SCRATCH_DIRECTORY = '/tmp/ow-scratch-501/19fa3e03/ddee1ba606f3'
const VISUALIZATION_ROOT = '/Users/user/Library/Application Support/openwaggle/visualizations'
const FAUX_PROVIDER = 'prefix-measurement'
const FAUX_MODEL = 'prefix-model'
const FAUX_CONTEXT_WINDOW = 200_000
const FAUX_MAX_TOKENS = 32_000
const MEASUREMENT_PROMPT = 'Reply with exactly OK and nothing else.'
const DEFAULT_MCP_SETTLE_MS = 3_000
const ONE_REQUEST = 1
const TWO_REQUESTS = 2
/** Fixed ids, so the measured prompt tokenizes the same way on every run. */
const MEASURED_SESSION_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const MEASURED_RUN_ID = '0d8bec21-9e09-4ace-bb66-66b1677cc926'

export interface CaptureFirstTurnOptions {
  /** The project the Session runs in. Its AGENTS.md, skills and MCP files are loaded as usual. */
  readonly projectPath: string
  readonly role?: PrefixSessionRole
  /** The Browser preview automation setting; on by default, as in the app. */
  readonly browserPreview?: boolean
  /**
   * Send a second prompt after MCP servers have had time to connect, the way a Run's later calls
   * see them. Without it only the first request is captured.
   */
  readonly secondRequestAfterMs?: number
}

export interface CapturedFirstTurn {
  /** The request contexts the provider received, first request first. */
  readonly requests: readonly PrefixContent[]
}

/** Pi ships ESM only; development scripts load it dynamically. */
function loadPiAi() {
  return import('@earendil-works/pi-ai')
}

function loadPiCodingAgent() {
  return import('@earendil-works/pi-coding-agent')
}

type PiAi = Awaited<ReturnType<typeof loadPiAi>>
type TranscriptContext = Parameters<PiAi['collapseSystemMessages']>[0]
type Message = TranscriptContext['messages'][number]

function messageText(pi: PiAi, message: Message) {
  return message.role === 'system' || message.role === 'assistant'
    ? ''
    : pi.contentText(message.content)
}

/** Splits a provider request into the leading system prompt, the tools and the Run's context. */
export function prefixContentOf(pi: PiAi, context: TranscriptContext): PrefixContent {
  const collapsed = pi.collapseSystemMessages(context)
  const leading = pi.getInitialSystemMessage(collapsed.messages)
  if (!leading) throw new Error('The provider request has no leading system message.')
  const base = typeof leading.content === 'string' ? leading.content : pi.contentText(leading.content)
  const sections = Object.entries(leading.sections ?? {}).flatMap(([name, text]) =>
    text === null ? [] : [{ name, text }],
  )
  // Host-authored Run context, such as the Run identity, travels as hidden messages beside the
  // prompt. The measured prompts and the faux replies to them are not part of the prefix.
  const runContext = collapsed.messages
    .map((message) => messageText(pi, message))
    .filter((text) => text.length > 0 && text !== MEASUREMENT_PROMPT)
  return {
    sections: [{ name: 'base', text: base }, ...sections],
    tools: pi.getCurrentTools(collapsed.messages).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    runContext,
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Builds one first Run the way the Session Host does, against an offline provider that records
 * each request instead of answering from a model, and returns what the provider was sent.
 */
export async function captureFirstTurnPrefix(
  options: CaptureFirstTurnOptions,
): Promise<CapturedFirstTurn> {
  const sessionId = MEASURED_SESSION_ID
  const runId = MEASURED_RUN_ID
  const [pi, { SessionManager }] = await Promise.all([loadPiAi(), loadPiCodingAgent()])
  const mcpPool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
  const faux = pi.fauxProvider({
    provider: FAUX_PROVIDER,
    models: [{ id: FAUX_MODEL, contextWindow: FAUX_CONTEXT_WINDOW, maxTokens: FAUX_MAX_TOKENS }],
  })
  const composition = await composeFirstTurnRun({
    projectPath: options.projectPath,
    role: options.role ?? 'independent',
    sessionId,
    runId,
    modelId: `${FAUX_PROVIDER}/${FAUX_MODEL}`,
    browserPreview: options.browserPreview ?? true,
    scratchDirectory: SCRATCH_DIRECTORY,
    visualizationDirectory: `${VISUALIZATION_ROOT}/${sessionId}`,
    docsBundlePath: PACKAGED_DOCS_BUNDLE_PATH,
    mcpPool,
  })
  const services = await createPiRuntimeServices(options.projectPath, {
    extensionFactories: [...composition.extensionFactories],
    trustedExtensionFactories: [...composition.trustedExtensionFactories],
    systemPromptAppendices: [...composition.systemPromptAppendices],
    visualizationDirectory: composition.visualizationDirectory,
  })
  services.modelRuntime.registerNativeProvider(faux.provider)
  await services.modelRuntime.setRuntimeApiKey(faux.provider.id, 'prefix-key')
  const requests: PrefixContent[] = []
  const answer = (context: TranscriptContext) => {
    requests.push(prefixContentOf(pi, context))
    return pi.fauxAssistantMessage('OK')
  }
  const prompts = options.secondRequestAfterMs === undefined ? ONE_REQUEST : TWO_REQUESTS
  faux.setResponses(Array.from({ length: prompts }, () => answer))
  const { session } = await createPiSessionForRun({
    projectRoot: options.projectPath,
    workspacePath: options.projectPath,
    services,
    model: faux.getModel(),
    sessionManager: SessionManager.inMemory(options.projectPath),
    scratchDirectory: SCRATCH_DIRECTORY,
    openWaggleUi: {
      sessionId: SessionId(sessionId),
      runId,
      resolveAuthorizationMode: async () => 'ask-for-approval',
      authorizationProjectPath: options.projectPath,
      signal: new AbortController().signal,
      onEvent: () => {},
    },
  })
  try {
    await session.prompt(MEASUREMENT_PROMPT)
    if (options.secondRequestAfterMs !== undefined) {
      await delay(options.secondRequestAfterMs || DEFAULT_MCP_SETTLE_MS)
      await session.prompt(MEASUREMENT_PROMPT)
    }
  } finally {
    await disposeOpenWagglePiSession(session)
    await mcpPool.closeAll()
    await services.modelRuntime.refresh({ allowNetwork: false })
  }
  return { requests }
}
