import { randomUUID } from 'node:crypto'
import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopCommandEnvelope,
  type DesktopCompletion,
  type DesktopServiceCommand,
  type DesktopServiceResult,
} from '@shared/types/desktop-service'
import {
  DesktopOperationIndeterminateError,
  desktopUnavailableError,
} from './desktop-service-errors'

const MAX_PENDING_BYTES = 16 * 1024 * 1024

interface PendingDesktopCommand {
  readonly envelope: DesktopCommandEnvelope
  readonly bytes: number
  readonly settle: (result: DesktopServiceResult | Error) => void
  dispatched: boolean
}

export function desktopPayloadBytes(
  value: unknown,
  limit: number = DESKTOP_SERVICE_LIMITS.payloadBytes,
) {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Desktop payload is not JSON serializable.')
  const bytes = Buffer.byteLength(encoded, 'utf8')
  if (bytes > limit) throw new Error('Desktop payload exceeds its byte limit.')
  return bytes
}

/** Each dispatched command is delivered at most once; uncertain writes are never replayed. */
export class DesktopServiceCommandQueue {
  private readonly pending = new Map<string, PendingDesktopCommand>()
  private readonly cancelled = new Map<string, string>()
  private readonly wakeups = new Set<() => void>()
  private retainedBytes = 0
  private wakeRevision = 0

  revision() {
    return this.wakeRevision
  }

  isIdle() {
    return this.pending.size === 0 && this.cancelled.size === 0
  }

  execute(command: DesktopServiceCommand, leaseId: string, signal: AbortSignal) {
    const bytes = desktopPayloadBytes(command)
    if (
      this.pending.size + this.cancelled.size >= DESKTOP_SERVICE_LIMITS.pendingCommands ||
      this.retainedBytes + bytes > MAX_PENDING_BYTES
    ) {
      return Promise.reject(new Error('The desktop command queue is full.'))
    }
    if (signal.aborted)
      return Promise.reject(new Error('Desktop operation was cancelled before dispatch.'))
    const commandId = randomUUID()
    return new Promise<DesktopServiceResult>((resolve, reject) => {
      const settle = (result: DesktopServiceResult | Error) => {
        if (!this.pending.delete(commandId)) return
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.retainedBytes -= bytes
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const entry: PendingDesktopCommand = {
        envelope: {
          commandId,
          leaseId,
          command,
          deadline: Date.now() + DESKTOP_SERVICE_LIMITS.commandTimeoutMs,
        },
        bytes,
        dispatched: false,
        settle,
      }
      const abort = () => {
        if (entry.dispatched) this.cancelled.set(commandId, leaseId)
        settle(
          entry.dispatched
            ? new DesktopOperationIndeterminateError()
            : new Error('Desktop operation was cancelled before dispatch.'),
        )
        this.wake()
      }
      const timer = setTimeout(abort, DESKTOP_SERVICE_LIMITS.commandTimeoutMs)
      timer.unref?.()
      this.pending.set(commandId, entry)
      this.retainedBytes += bytes
      signal.addEventListener('abort', abort, { once: true })
      this.wake()
    })
  }

  take(leaseId: string) {
    const commands: DesktopCommandEnvelope[] = []
    let bytes = 0
    for (const entry of this.pending.values()) {
      if (entry.envelope.leaseId !== leaseId || entry.dispatched) continue
      if (
        commands.length >= DESKTOP_SERVICE_LIMITS.batchCommands ||
        bytes + entry.bytes > DESKTOP_SERVICE_LIMITS.payloadBytes
      )
        break
      entry.dispatched = true
      commands.push(entry.envelope)
      bytes += entry.bytes
    }
    return commands
  }

  complete(leaseId: string, completion: DesktopCompletion) {
    if (this.cancelled.get(completion.commandId) === leaseId) {
      this.cancelled.delete(completion.commandId)
      return false
    }
    const entry = this.pending.get(completion.commandId)
    if (!entry?.dispatched || entry.envelope.leaseId !== leaseId) return false
    if (Date.now() >= entry.envelope.deadline) {
      entry.settle(new DesktopOperationIndeterminateError())
      return false
    }
    desktopPayloadBytes(completion, DESKTOP_SERVICE_LIMITS.resultBytes)
    if (completion.outcome === 'failure') {
      entry.settle(
        completion.uncertain
          ? new DesktopOperationIndeterminateError()
          : new Error(completion.message),
      )
    } else {
      if (
        completion.result.service !== entry.envelope.command.service ||
        completion.result.operation !== entry.envelope.command.operation
      ) {
        throw new Error('Desktop completion does not match the dispatched operation.')
      }
      entry.settle(completion.result)
    }
    return true
  }

  cancelledFor(leaseId: string) {
    return [...this.cancelled].filter(([, owner]) => owner === leaseId).map(([id]) => id)
  }

  revoke(leaseId: string) {
    for (const entry of this.pending.values()) {
      if (entry.envelope.leaseId !== leaseId) continue
      entry.settle(
        entry.dispatched ? new DesktopOperationIndeterminateError() : desktopUnavailableError(),
      )
    }
    for (const [id, owner] of this.cancelled) if (owner === leaseId) this.cancelled.delete(id)
    this.wake()
  }

  wake() {
    this.wakeRevision += 1
    for (const wake of this.wakeups) wake()
  }

  wait(
    signal: AbortSignal,
    afterRevision: number,
    timeoutMs: number = DESKTOP_SERVICE_LIMITS.pollTimeoutMs,
  ) {
    if (signal.aborted || afterRevision !== this.wakeRevision) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.wakeups.delete(finish)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      this.wakeups.add(finish)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || afterRevision !== this.wakeRevision) finish()
    })
  }
}
