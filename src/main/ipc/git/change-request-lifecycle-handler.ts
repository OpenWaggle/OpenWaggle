import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { sourceControlAttentionSchema } from '@shared/schemas/source-control'
import { WorkingPath } from '@shared/types/brand'
import type {
  ChangeRequestMergeCandidate,
  ChangeRequestMergeCandidateResult,
  MergeChangeRequestPayload,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { invokeConfiguredHostUi } from '../../application/gui-session-command-router'
import { browserWindowFromWebContents, showMessageBox } from '../../desktop-ui'
import {
  mergeConfirmedSessionChangeRequest,
  sessionChangeRequestMergeCandidate,
} from '../../services/source-control/session-change-request-merge'
import { loadSessionChangeRequestPanel } from '../../services/source-control/session-change-requests'
import {
  decodeSessionMergeArguments,
  decodeSessionRequestArguments,
} from '../../services/source-control/session-request-arguments'
import { hostHandle, RelayedHostResult, relayingHandle } from '../typed-ipc'

const candidateResultSchema = Schema.Union(
  Schema.Struct({
    ok: Schema.Literal(true),
    candidate: Schema.Struct({
      provider: Schema.Literal('github', 'gitlab'),
      account: Schema.NullOr(Schema.String),
      title: Schema.String,
      headRef: Schema.String,
      baseRef: Schema.String,
    }),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literal(
      'cli-missing',
      'not-authenticated',
      'no-change-request',
      'cancelled',
      'invalid-target',
      'unknown',
    ),
    message: Schema.String,
    attention: Schema.optional(sourceControlAttentionSchema),
  }),
)

export function mergeConfirmationDetail(
  candidate: ChangeRequestMergeCandidate,
  payload: MergeChangeRequestPayload,
) {
  const account = candidate.account ? `\nAs: @${candidate.account}` : ''
  return `${candidate.headRef} → ${candidate.baseRef}\n\nMethod: ${payload.method}\nHead: ${payload.expectedHeadCommit}${account}`
}

async function askMergeConfirmation(
  event: Electron.IpcMainInvokeEvent,
  candidate: ChangeRequestMergeCandidate,
  payload: MergeChangeRequestPayload,
) {
  const label = candidate.provider === 'github' ? 'pull request' : 'merge request'
  const ownerWindow = browserWindowFromWebContents(event.sender)
  const confirmation = await showMessageBox(ownerWindow, {
    type: 'warning',
    title: `Merge ${label}`,
    message: `Merge "${candidate.title}"?`,
    detail: mergeConfirmationDetail(candidate, payload),
    buttons: ['Cancel', `Merge ${label}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return confirmation.response === 1
}

/** The Session Host validates and merges; only the confirmation dialog belongs to the window. */
function mergeEffect(
  event: Electron.IpcMainInvokeEvent,
  rawSessionId: unknown,
  rawPath: unknown,
  rawPayload: unknown,
) {
  return Effect.gen(function* () {
    const { sessionId, workingPath, payload } = decodeSessionMergeArguments(
      rawSessionId,
      rawPath,
      rawPayload,
    )
    const remoteCandidate = yield* Effect.promise(() =>
      invokeConfiguredHostUi('git:change-request:merge-candidate', [
        sessionId,
        WorkingPath(workingPath),
        payload,
      ]),
    )
    const candidate: ChangeRequestMergeCandidateResult = remoteCandidate.handled
      ? decodeUnknownOrThrow(candidateResultSchema, remoteCandidate.result)
      : yield* sessionChangeRequestMergeCandidate(sessionId, workingPath, payload)
    if (!candidate.ok) return candidate
    const confirmed = yield* Effect.promise(() =>
      askMergeConfirmation(event, candidate.candidate, payload),
    )
    if (!confirmed) return { ok: false, code: 'cancelled', message: 'Merge cancelled.' } as const
    const remoteMerge = yield* Effect.promise(() =>
      invokeConfiguredHostUi('git:change-request:merge-confirmed', [
        sessionId,
        WorkingPath(workingPath),
        payload,
      ]),
    )
    if (remoteMerge.handled) return new RelayedHostResult(remoteMerge.result)
    return yield* mergeConfirmedSessionChangeRequest(sessionId, workingPath, payload)
  })
}

export function registerGitChangeRequestLifecycleHandlers(): void {
  hostHandle('git:change-request:panel', (_event, rawSessionId, rawPath, rawUrl) => {
    const { sessionId, workingPath, requestUrl } = decodeSessionRequestArguments(
      rawSessionId,
      rawPath,
      rawUrl,
    )
    return loadSessionChangeRequestPanel(sessionId, workingPath, requestUrl)
  })
  relayingHandle('git:change-request:merge', (event, sessionId, path, payload) =>
    mergeEffect(event, sessionId, path, payload),
  )
}
