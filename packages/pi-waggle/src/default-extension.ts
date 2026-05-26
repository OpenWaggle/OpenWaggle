import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
} from '@mariozechner/pi-coding-agent'
import { buildWaggleTurnPrompt } from '@openwaggle/waggle-core'
import { defaultWaggleCommandCompletions, handleDefaultWaggleCommand } from './default-commands'
import {
  clearRunStatus,
  createStartDefaultWaggleRun,
  type DefaultPiWaggleRunState,
  setWaggleStatus,
} from './default-run'
import { latestPiWaggleModeStateFromBranch } from './mode-state'
import { PI_WAGGLE_TURN_CUSTOM_TYPE, PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from './protocol'
import { registerPiWaggleRenderers } from './renderers'

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

type ContextMessage = ContextEvent['messages'][number]

type ContextResult = { readonly messages?: ContextEvent['messages'] }

function isWaggleDisplayMessage(message: ContextMessage) {
  return (
    message.role === 'custom' &&
    (message.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE ||
      message.customType === PI_WAGGLE_TURN_CUSTOM_TYPE)
  )
}

function buildSteeringContent(event: InputEvent) {
  return event.images && event.images.length > 0
    ? [{ type: 'text' as const, text: event.text }, ...event.images]
    : event.text
}

function rewriteLatestUserMessage(input: {
  readonly messages: readonly ContextMessage[]
  readonly run: DefaultPiWaggleRunState
}) {
  let replacedCurrentUserPrompt = false
  return [...input.messages]
    .reverse()
    .map((message) => {
      if (replacedCurrentUserPrompt || message.role !== 'user') return message

      replacedCurrentUserPrompt = true
      return {
        ...message,
        content: [
          {
            type: 'text' as const,
            text: buildWaggleTurnPrompt({
              config: input.run.config,
              turnNumber: input.run.turnNumber,
              userPrompt: input.run.userPrompt,
            }),
          },
          ...input.run.userImages,
        ],
      }
    })
    .reverse()
}

export default function defaultPiWaggleExtension(pi: ExtensionAPI) {
  let activeRun: DefaultPiWaggleRunState | null = null
  const getActiveRun = () => activeRun
  const setActiveRun = (run: DefaultPiWaggleRunState | null) => {
    activeRun = run
  }
  const startDefaultWaggleRun = createStartDefaultWaggleRun({ getActiveRun, setActiveRun })

  registerPiWaggleRenderers(pi)
  pi.registerCommand('waggle', {
    description: 'Enable Waggle multi-agent mode, optionally with a preset and prompt.',
    getArgumentCompletions: defaultWaggleCommandCompletions,
    handler: (args, ctx) =>
      handleDefaultWaggleCommand({ pi, args, ctx, setActiveRun, startRun: startDefaultWaggleRun }),
  })
  pi.registerCommand('standard', {
    description: 'Disable Waggle mode for the current branch.',
    handler: (_args, ctx) =>
      handleDefaultWaggleCommand({
        pi,
        args: 'off',
        ctx,
        setActiveRun,
        startRun: startDefaultWaggleRun,
      }),
  })
  pi.on('context', (event): ContextResult => {
    const messagesWithoutWaggleDisplay = event.messages.filter(
      (message) => !isWaggleDisplayMessage(message),
    )
    const currentRun = getActiveRun()
    return {
      messages: currentRun
        ? rewriteLatestUserMessage({ messages: messagesWithoutWaggleDisplay, run: currentRun })
        : messagesWithoutWaggleDisplay,
    }
  })
  pi.on('session_start', (_event, ctx) => {
    const state = latestPiWaggleModeStateFromBranch(ctx.sessionManager)
    setWaggleStatus(ctx, state?.enabled && state.config ? 'Waggle enabled' : undefined)
  })
  pi.on('session_shutdown', (_event, ctx) => {
    clearRunStatus(ctx, setActiveRun)
  })
  pi.on('input', async (event: InputEvent, ctx) => {
    if (event.source === 'extension' || event.text.trim().startsWith('/')) {
      return { action: 'continue' }
    }
    if (activeRun) {
      clearRunStatus(ctx, setActiveRun)
      pi.sendUserMessage(buildSteeringContent(event), { deliverAs: 'steer' })
      return { action: 'handled' }
    }
    if (!ctx.isIdle()) return { action: 'continue' }

    const state = latestPiWaggleModeStateFromBranch(ctx.sessionManager)
    if (!state?.enabled || !state.config) return { action: 'continue' }

    try {
      await startDefaultWaggleRun({
        pi,
        ctx,
        config: state.config,
        prompt: event.text,
        images: event.images,
        setActiveRun,
        dispatchPrompt: false,
      })
    } catch (error) {
      notify(ctx, error instanceof Error ? error.message : String(error), 'error')
      activeRun = null
    }
    return { action: 'continue' }
  })
  pi.on('turn_end', async (event, ctx) => {
    const currentRun = activeRun
    if (currentRun) await currentRun.onTurnEnd(event, ctx)
  })
  pi.on('agent_end', async (event, ctx) => {
    const currentRun = activeRun
    if (currentRun) await currentRun.onAgentEnd(event, ctx)
  })
}
