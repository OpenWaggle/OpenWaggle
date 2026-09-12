import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalAttachResult,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalKey,
  TerminalWriteResult,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import {
  decideTerminalInputIdentity,
  echoTerminalInputIdentity,
  receiptForTerminalInput,
} from './terminal-input-idempotency'
import { terminalOperationBlockDisposition } from './terminal-operation-queue'
import { beginTerminalProjectAction, terminalInputByteLimit } from './terminal-project-action'
import { resolveTerminalKey, type TerminalActionContext } from './terminal-service-actions'

function rejectedInput(
  reason: Extract<TerminalWriteResult, { status: 'rejected' }>['reason'],
  identity?: TerminalInputIdentity,
) {
  return echoTerminalInputIdentity({ status: 'rejected', acceptedBytes: 0, reason }, identity)
}

function queuePreOpenInput(
  context: TerminalActionContext,
  key: TerminalKey,
  data: string,
  identity?: TerminalInputIdentity,
  intent?: TerminalInputIntent,
): TerminalWriteResult {
  const acceptedBytes = Buffer.byteLength(data, 'utf8')
  if (acceptedBytes === 0) return rejectedInput('empty', identity)
  if (acceptedBytes > terminalInputByteLimit(intent)) {
    return rejectedInput('input-too-large', identity)
  }
  if (!context.inFlightOpens.has(key)) return rejectedInput('terminal-not-open', identity)
  const pending = context.pendingInputByKey.get(key) ?? {
    parts: [],
    bytes: 0,
    inputGeneration: null,
    lastInputReceipt: null,
    projectAction: null,
  }
  const identityDecision = decideTerminalInputIdentity(pending, data, identity, intent)
  if (identityDecision.kind === 'result') return identityDecision.result
  if (pending.bytes + acceptedBytes > TERMINAL.MAX_PENDING_INPUT_BYTES) {
    return rejectedInput('queue-full', identity)
  }
  if (!beginTerminalProjectAction(pending, intent)) {
    return rejectedInput('project-action-pending', identity)
  }
  pending.parts.push({ data, ...(intent === undefined ? {} : { intent }) })
  pending.bytes += acceptedBytes
  const result = echoTerminalInputIdentity({ status: 'queued', acceptedBytes }, identity)
  const receipt = receiptForTerminalInput(identity, data, result, intent)
  if (receipt !== null) pending.lastInputReceipt = receipt
  context.pendingInputByKey.set(key, pending)
  return result
}

function writeTerminalNow(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  data: string,
  identity?: TerminalInputIdentity,
  intent?: TerminalInputIntent,
): TerminalWriteResult {
  const requestedKey = terminalKeyOf(ownerKey, terminalId)
  const key = resolveTerminalKey(context, requestedKey)
  const record = context.runtime.records.get(key)
  if (
    terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: record?.ownerKey ?? ownerKey,
      cwd: record?.cwd,
    }) !== 'none'
  ) {
    return rejectedInput('terminal-not-open', identity)
  }
  if (record === undefined) return queuePreOpenInput(context, key, data, identity, intent)
  const identityDecision = decideTerminalInputIdentity(record, data, identity, intent)
  if (identityDecision.kind === 'result') return identityDecision.result
  const result = echoTerminalInputIdentity(
    context.runtime.writeInput(record, data, intent),
    identity,
  )
  const receipt = receiptForTerminalInput(identity, data, result, intent)
  if (receipt !== null) record.lastInputReceipt = receipt
  return result
}

function stageTerminalInputForLaunch(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  data: string,
  identity?: TerminalInputIdentity,
  intent?: TerminalInputIntent,
): TerminalWriteResult | null {
  // Only the generation/sequence protocol can reserve a delivery safely before
  // the lifecycle completes. Legacy anonymous writers retain serialized wait
  // semantics because an ambiguous response cannot be deduplicated.
  if (identity === undefined) return null
  const requestedKey = terminalKeyOf(ownerKey, terminalId)
  const key = resolveTerminalKey(context, requestedKey)
  const record = context.runtime.records.get(key)
  if (record === undefined || !context.inFlightOpens.has(key)) return null
  if (
    terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: record.ownerKey,
      cwd: record.cwd,
    }) !== 'none'
  ) {
    return null
  }

  const identityDecision = decideTerminalInputIdentity(record, data, identity, intent)
  if (identityDecision.kind === 'result') return identityDecision.result
  const result = echoTerminalInputIdentity(
    context.runtime.stageInputForLaunch(record, data, intent),
    identity,
  )
  const receipt = receiptForTerminalInput(identity, data, result, intent)
  if (receipt === null) return result
  record.lastInputReceipt = receipt

  // The accepted bytes already belong to main. Wait for the full lifecycle
  // queue, including a reload's newer open or an owner migration, then drain
  // against the record's current key and spawn readiness.
  void waitForTerminalInputTurn(context, requestedKey)
    .then((available) => {
      if (!available) return
      const currentKey = resolveTerminalKey(context, requestedKey)
      const current = context.runtime.records.get(currentKey)
      if (current === record) context.runtime.resumeInput(current)
    })
    .catch(() => undefined)
  return result
}

function inputNeedsLifecycleWait(context: TerminalActionContext, requestedKey: TerminalKey) {
  const key = resolveTerminalKey(context, requestedKey)
  const record = context.runtime.records.get(key)
  const disposition = terminalOperationBlockDisposition(context.operationQueue, {
    key,
    ownerKey: record?.ownerKey ?? ownerKeyFromTerminalKey(requestedKey),
    cwd: record?.cwd,
  })
  if (disposition === 'retry') return true
  return (
    record !== undefined &&
    (context.inFlightOpens.has(key) || context.operationQueue.tails.has(key))
  )
}

/**
 * Wait until the requested terminal has a stable launch context. Initial-open
 * input deliberately bypasses this path and stages in `pendingInputByKey`;
 * existing shells instead serialize behind clear/restart/re-open and owner
 * migration so bytes never land in the shell being replaced.
 */
async function waitForTerminalInputTurn(context: TerminalActionContext, requestedKey: TerminalKey) {
  while (true) {
    const key = resolveTerminalKey(context, requestedKey)
    const record = context.runtime.records.get(key)
    const disposition = terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: record?.ownerKey ?? ownerKeyFromTerminalKey(requestedKey),
      cwd: record?.cwd,
    })
    if (disposition === 'cancel') return false
    if (disposition === 'retry') {
      await context.operationQueue.scopeTail
      continue
    }
    // No record means this is either the intentionally fast pre-open staging
    // path or a terminal that has finished closing. `writeTerminalNow`
    // distinguishes those cases using the in-flight launch registry.
    if (record === undefined) return true

    const launch = context.inFlightOpens.get(key)
    const tail = context.operationQueue.tails.get(key)
    if (launch === undefined && tail === undefined) return true
    if (launch !== undefined) {
      let snapshot: TerminalAttachResult
      try {
        snapshot = await launch
      } catch {
        return false
      }
      if (!snapshot.running) return false
      continue
    }
    // Clear has no launch result but still owns the per-terminal lifecycle
    // tail. Its caller observes persistence errors; input resumes only after
    // the mutation has either completed or rolled back safely.
    await tail
  }
}

export function writeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  data: string,
  identity?: TerminalInputIdentity,
  intent?: TerminalInputIntent,
) {
  return Effect.suspend(() => {
    const requestedKey = terminalKeyOf(ownerKey, terminalId)
    const staged = stageTerminalInputForLaunch(
      context,
      ownerKey,
      terminalId,
      data,
      identity,
      intent,
    )
    if (staged !== null) return Effect.succeed(staged)
    if (!inputNeedsLifecycleWait(context, requestedKey)) {
      return Effect.sync(() =>
        writeTerminalNow(context, ownerKey, terminalId, data, identity, intent),
      )
    }
    return Effect.promise(async () => {
      const available = await waitForTerminalInputTurn(context, requestedKey)
      return available
        ? writeTerminalNow(context, ownerKey, terminalId, data, identity, intent)
        : rejectedInput('terminal-not-open', identity)
    })
  })
}

export function forceReleaseTerminalInputAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
) {
  const releaseNow = (): TerminalInputReleaseResult => {
    const key = resolveTerminalKey(context, terminalKeyOf(ownerKey, terminalId))
    const record = context.runtime.records.get(key)
    if (record === undefined) return { status: 'terminal-not-open', releasedBytes: 0 }
    if (
      terminalOperationBlockDisposition(context.operationQueue, {
        key,
        ownerKey: record.ownerKey,
        cwd: record.cwd,
      }) !== 'none'
    ) {
      return { status: 'terminal-not-open', releasedBytes: 0 }
    }
    return context.runtime.forceReleaseInput(record)
  }
  return Effect.suspend(() => {
    const requestedKey = terminalKeyOf(ownerKey, terminalId)
    if (!inputNeedsLifecycleWait(context, requestedKey)) return Effect.sync(releaseNow)
    return Effect.promise(async () => {
      const available = await waitForTerminalInputTurn(context, requestedKey)
      if (available) return releaseNow()
      return { status: 'terminal-not-open', releasedBytes: 0 } as const
    })
  })
}
