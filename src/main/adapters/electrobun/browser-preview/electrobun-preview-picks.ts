import { randomUUID } from 'node:crypto'
import { decode, EvaluateResultSchema } from './electrobun-preview-cdp-protocol'
import { browserPreviewPickerScript } from './electrobun-preview-page-script'
import type { CdpSend } from './electrobun-preview-screenshots'

interface PendingPick {
  readonly contextId: number
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
}

/** A pick result from the page's world. */
export interface CefPickMessage {
  readonly token: string
  readonly result: unknown
  readonly failed?: boolean | undefined
}

async function evaluateIn(send: CdpSend, contextId: number, expression: string) {
  const evaluated = decode(
    EvaluateResultSchema,
    await send('Runtime.evaluate', {
      expression,
      contextId,
      userGesture: true,
      returnByValue: true,
    }),
  )
  if (evaluated === null) throw new Error('The browser preview returned a malformed result.')
  if (evaluated.exceptionDetails !== undefined) {
    throw new Error(`The browser preview script failed: ${evaluated.exceptionDetails.text}`)
  }
}

/**
 * The element pickers running in one CEF page, each in the page script's world of the main frame.
 * A result counts only from the world its picker started in; when that world goes, with the
 * document it belonged to, the pick ends as the user cancelling it would.
 */
export class CefPicks {
  private readonly pending = new Map<string, PendingPick>()

  /** Starts `picker` in `contextId`; resolves with its raw result once the user finishes. */
  async run(send: CdpSend, contextId: number, picker: string): Promise<unknown> {
    const token = randomUUID()
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(token, { contextId, resolve, reject })
    })
    try {
      await evaluateIn(send, contextId, browserPreviewPickerScript(picker, token))
    } catch (error) {
      this.pending.delete(token)
      throw error
    }
    return result
  }

  /** Runs a short picker control script in `contextId`. */
  control(send: CdpSend, contextId: number, script: string): Promise<void> {
    return evaluateIn(send, contextId, script)
  }

  receive(contextId: number | undefined, message: CefPickMessage): void {
    const pick = this.pending.get(message.token)
    if (pick === undefined || pick.contextId !== contextId) return
    this.pending.delete(message.token)
    if (message.failed === true) pick.reject(new Error('The element picker failed in the page.'))
    else pick.resolve(message.result)
  }

  /** Fails the picks of `contextId`, whose page sent a message too large to read. */
  reject(contextId: number | undefined, reason: string): void {
    for (const [token, pick] of this.pending) {
      if (pick.contextId !== contextId) continue
      this.pending.delete(token)
      pick.reject(new Error(reason))
    }
  }

  /** Ends the picks of a world that went away, or of every world for `null`. */
  end(contextId: number | null): void {
    for (const [token, pick] of this.pending) {
      if (contextId !== null && pick.contextId !== contextId) continue
      this.pending.delete(token)
      pick.resolve(null)
    }
  }
}
