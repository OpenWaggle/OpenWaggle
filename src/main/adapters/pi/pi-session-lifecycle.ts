import type {
  AgentSession,
  CreateAgentSessionResult,
  SessionShutdownEvent,
} from '@earendil-works/pi-coding-agent'
import { createAgentSessionFromServices } from '@earendil-works/pi-coding-agent'
import { createLogger } from '../../logger'
import {
  createPiInteractionUiContext,
  type PiInteractionUiContextInput,
} from './agent-kernel/interaction-ui-context'
import {
  getOpenWaggleMcpRuntimeContextForServices,
  type OpenWaggleMcpRuntimeContext,
  withOpenWaggleMcpAdapterProcessContext,
} from './pi-mcp-config-service'

const logger = createLogger('pi-session-lifecycle')
const mcpRuntimeContextsBySession = new WeakMap<AgentSession, OpenWaggleMcpRuntimeContext>()

type PiAgentSessionFromServicesOptions = Parameters<typeof createAgentSessionFromServices>[0]

export type OpenWaggleAgentSessionOptions = PiAgentSessionFromServicesOptions & {
  readonly openWaggleUi?: PiInteractionUiContextInput
}

async function bindSessionExtensions(
  session: AgentSession,
  input: Pick<OpenWaggleAgentSessionOptions, 'openWaggleUi'>,
) {
  const baseUiContext = session.extensionRunner.getUIContext()
  await session.bindExtensions({
    ...(input.openWaggleUi
      ? { uiContext: createPiInteractionUiContext(input.openWaggleUi, baseUiContext) }
      : {}),
  })
}

export async function createOpenWaggleAgentSessionFromServices(
  options: OpenWaggleAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
  const { openWaggleUi, ...piOptions } = options
  const context = getOpenWaggleMcpRuntimeContextForServices(options.services)
  return withOpenWaggleMcpAdapterProcessContext(context, async () => {
    const result = await createAgentSessionFromServices(piOptions)
    if (context) {
      mcpRuntimeContextsBySession.set(result.session, context)
    }
    try {
      await bindSessionExtensions(result.session, { openWaggleUi })
      return result
    } catch (error) {
      await disposeOpenWagglePiSession(result.session)
      throw error
    }
  })
}

export async function disposeOpenWagglePiSession(
  session: AgentSession,
  reason: SessionShutdownEvent['reason'] = 'quit',
): Promise<void> {
  const event: SessionShutdownEvent = { type: 'session_shutdown', reason }
  const context = mcpRuntimeContextsBySession.get(session) ?? null
  try {
    await withOpenWaggleMcpAdapterProcessContext(context, () => session.extensionRunner.emit(event))
  } catch (error) {
    logger.warn('Pi session shutdown hook failed during disposal', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    mcpRuntimeContextsBySession.delete(session)
    session.dispose()
  }
}

export async function withOpenWagglePiSessionLifecycleContext<T>(
  session: AgentSession,
  operation: () => Promise<T>,
): Promise<T> {
  const context = mcpRuntimeContextsBySession.get(session) ?? null
  return withOpenWaggleMcpAdapterProcessContext(context, operation)
}
