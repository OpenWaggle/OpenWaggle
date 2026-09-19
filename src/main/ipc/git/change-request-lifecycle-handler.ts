import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { MergeChangeRequestPayload, MergeChangeRequestResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { browserWindowFromWebContents, showMessageBox } from '../../desktop-ui'
import { typedHandle } from '../typed-ipc'
import {
  isSourceControlFailure,
  loadChangeRequestPanel,
  NO_SOURCE_CONTROL_PROVIDER,
  type ResolvedChangeRequestProvider,
  requestedChangeRequestIdentity,
  SESSION_CHANGE_REQUEST_MISMATCH,
  sessionOwnedChangeRequestReferences,
  validateMergeCandidate,
  verifyMergedDetails,
} from './change-request-lifecycle-service'
import { resolveSourceControlProvider } from './change-request-provider'
import { withGitMutationLock } from './mutation-lock'
import { verifySessionWorkingPath } from './session-working-path'
import { projectPathSchema } from './shared'

const sessionIdSchema = Schema.String.pipe(Schema.minLength(1))
const requestUrlSchema = Schema.String.pipe(Schema.minLength(1))
const mergePayloadSchema = Schema.Struct({
  url: requestUrlSchema,
  expectedHeadCommit: Schema.String.pipe(Schema.minLength(1)),
  method: Schema.Literal('merge', 'squash', 'rebase'),
})

function providerLabel(provider: ResolvedChangeRequestProvider) {
  return provider.info.id === 'github' ? 'pull request' : 'merge request'
}

async function askMergeConfirmation(
  event: Electron.IpcMainInvokeEvent,
  resolved: ResolvedChangeRequestProvider,
  title: string,
  headRef: string,
  baseRef: string,
  payload: MergeChangeRequestPayload,
) {
  const label = providerLabel(resolved)
  const ownerWindow = browserWindowFromWebContents(event.sender)
  const confirmation = await showMessageBox(ownerWindow, {
    type: 'warning',
    title: `Merge ${label}`,
    message: `Merge "${title}"?`,
    detail: `${headRef} → ${baseRef}\n\nMethod: ${payload.method}\nHead: ${payload.expectedHeadCommit}`,
    buttons: ['Cancel', `Merge ${label}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return confirmation.response === 1
}

function panelEffect(rawSessionId: unknown, rawPath: unknown, rawUrl: unknown) {
  return Effect.gen(function* () {
    const sessionId = SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId))
    const workingPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const requestUrl = decodeUnknownOrThrow(requestUrlSchema, rawUrl)
    if (!(yield* verifySessionWorkingPath(sessionId, workingPath))) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const resolved = yield* Effect.promise(() => resolveSourceControlProvider(workingPath))
    if (!resolved) return NO_SOURCE_CONTROL_PROVIDER
    const identity = requestedChangeRequestIdentity(resolved, requestUrl)
    if (!identity) return SESSION_CHANGE_REQUEST_MISMATCH
    const ownership = yield* sessionOwnedChangeRequestReferences(
      sessionId,
      workingPath,
      resolved,
      identity.url,
    )
    return yield* Effect.promise(() =>
      loadChangeRequestPanel(
        workingPath,
        identity.url,
        resolved,
        ownership.branch,
        ownership.references,
      ),
    )
  })
}

function mergeEffect(
  event: Electron.IpcMainInvokeEvent,
  rawSessionId: unknown,
  rawPath: unknown,
  rawPayload: unknown,
) {
  return Effect.gen(function* () {
    const sessionId = SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId))
    const workingPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const payload = decodeUnknownOrThrow(
      mergePayloadSchema,
      rawPayload,
    ) satisfies MergeChangeRequestPayload
    if (!(yield* verifySessionWorkingPath(sessionId, workingPath))) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const resolved = yield* Effect.promise(() => resolveSourceControlProvider(workingPath))
    if (!resolved) return NO_SOURCE_CONTROL_PROVIDER
    const identity = requestedChangeRequestIdentity(resolved, payload.url)
    if (!identity) return SESSION_CHANGE_REQUEST_MISMATCH
    const ownership = yield* sessionOwnedChangeRequestReferences(
      sessionId,
      workingPath,
      resolved,
      identity.url,
    )
    if (!ownership.references.has(identity.reference)) return SESSION_CHANGE_REQUEST_MISMATCH
    const before = yield* Effect.promise(() =>
      resolved.provider.getChangeRequestDetails(workingPath, identity.reference),
    )
    const candidate = validateMergeCandidate(
      resolved,
      before,
      identity.reference,
      payload.expectedHeadCommit,
      payload.method,
    )
    if (isSourceControlFailure(candidate)) return candidate
    const confirmed = yield* Effect.promise(() =>
      askMergeConfirmation(
        event,
        resolved,
        candidate.title,
        candidate.headRef,
        candidate.baseRef,
        payload,
      ),
    )
    if (!confirmed) return { ok: false, code: 'cancelled', message: 'Merge cancelled.' } as const

    const mergeResult = yield* withGitMutationLock(
      workingPath,
      revalidateAndMerge(sessionId, workingPath, payload, resolved, identity.reference),
    )
    return mergeResult satisfies MergeChangeRequestResult
  })
}

function revalidateAndMerge(
  sessionId: SessionId,
  workingPath: string,
  payload: MergeChangeRequestPayload,
  resolved: ResolvedChangeRequestProvider,
  expectedReference: string,
) {
  return Effect.gen(function* () {
    if (!(yield* verifySessionWorkingPath(sessionId, workingPath))) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const currentProvider = yield* Effect.promise(() => resolveSourceControlProvider(workingPath))
    if (!currentProvider || currentProvider.info.id !== resolved.info.id) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const currentIdentity = requestedChangeRequestIdentity(currentProvider, payload.url)
    if (!currentIdentity || currentIdentity.reference !== expectedReference) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const ownership = yield* sessionOwnedChangeRequestReferences(
      sessionId,
      workingPath,
      currentProvider,
      currentIdentity.url,
    )
    if (!ownership.references.has(currentIdentity.reference)) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const refreshed = yield* Effect.promise(() =>
      currentProvider.provider.getChangeRequestDetails(workingPath, currentIdentity.reference),
    )
    const candidate = validateMergeCandidate(
      currentProvider,
      refreshed,
      currentIdentity.reference,
      payload.expectedHeadCommit,
      payload.method,
    )
    if (isSourceControlFailure(candidate)) return candidate
    const result = yield* Effect.promise(() =>
      currentProvider.provider.mergeChangeRequest(
        workingPath,
        currentIdentity.reference,
        payload.method,
        payload.expectedHeadCommit,
      ),
    )
    return verifyMergedDetails(currentProvider, result, currentIdentity.reference)
  })
}

export function registerGitChangeRequestLifecycleHandlers(): void {
  typedHandle('git:change-request:panel', (_event, sessionId, path, url) =>
    panelEffect(sessionId, path, url),
  )
  typedHandle('git:change-request:merge', (event, sessionId, path, payload) =>
    mergeEffect(event, sessionId, path, payload),
  )
}
