import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { WaggleTurn } from '@openwaggle/waggle-core'

const NEXT_TURN_DISPLAY_OFFSET = 1

/** The run the default extension drives, as far as its status cares. */
type ActiveRunSetter = (run: null) => void

export function setWaggleStatus(ctx: ExtensionContext, text: string | undefined) {
  if (ctx.hasUI) ctx.ui.setStatus('pi-waggle', text)
}

export function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

export function updateRunningStatus(
  ctx: ExtensionContext,
  turn: WaggleTurn,
  resolvedModelReference: string,
) {
  setWaggleStatus(
    ctx,
    `Waggle: ${turn.agent.label} (${resolvedModelReference}) · turn ${String(
      turn.turnNumber + NEXT_TURN_DISPLAY_OFFSET,
    )}`,
  )
  if (ctx.hasUI) ctx.ui.setWorkingMessage(`Waggle: ${turn.agent.label}`)
}

export function clearRunStatus(ctx: ExtensionContext, setActiveRun: ActiveRunSetter) {
  setActiveRun(null)
  setWaggleStatus(ctx, undefined)
  if (ctx.hasUI) ctx.ui.setWorkingMessage()
}
