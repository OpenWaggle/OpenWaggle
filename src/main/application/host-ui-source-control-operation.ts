import { match } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { sourceControlSettingsPatchSchema } from '@shared/schemas/source-control'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import { HOST_UI_REVISION_23_REQUIRED_CHANNELS } from '@shared/types/host-ui-protocol'
import { LOCAL_SESSION_SOURCE_CONTROL_REVISION } from '@shared/types/local-session-protocol-revisions'
import * as Effect from 'effect/Effect'
import {
  mergeConfirmedSessionChangeRequest,
  sessionChangeRequestMergeCandidate,
} from '../services/source-control/session-change-request-merge'
import { loadSessionChangeRequestPanel } from '../services/source-control/session-change-requests'
import {
  decodeSessionGitOutputsArguments,
  decodeSessionMergeArguments,
  decodeSessionRequestArguments,
  decodeSessionWorkingPathArguments,
} from '../services/source-control/session-request-arguments'
import { sourceControlSettingsAccess } from '../services/source-control/source-control-runtime'
import {
  invalidHostUiInput,
  requireHostUiArgCount,
  TWO_ARGUMENTS,
} from './host-ui-operation-validation'
import {
  recordSessionGitOutputsOperation,
  verifySessionGitWorkingPath,
} from './session-git-outputs'

const THREE_ARGUMENTS = 3

export type HostUiSourceControlChannel = (typeof HOST_UI_REVISION_23_REQUIRED_CHANNELS)[number]

export function isHostUiSourceControlChannel(
  channel: HostBackedGuiChannel,
): channel is HostUiSourceControlChannel {
  return HOST_UI_REVISION_23_REQUIRED_CHANNELS.some((candidate) => candidate === channel)
}

function threeArguments(args: readonly unknown[]): [unknown, unknown, unknown] {
  const [first, second, third] = args
  return [first, second, third]
}

function decoded<A, R>(decode: () => A, run: (value: A) => Effect.Effect<unknown, unknown, R>) {
  return Effect.suspend(() => run(decode()))
}

/** Session-coupled source-control operations the Session Host runs for the window (ADR 0048). */
export function dispatchHostUiSourceControlOperation(
  channel: HostUiSourceControlChannel,
  args: readonly unknown[],
  negotiatedRevision?: number,
) {
  if (
    negotiatedRevision !== undefined &&
    negotiatedRevision < LOCAL_SESSION_SOURCE_CONTROL_REVISION
  ) {
    return invalidHostUiInput(
      `Source control requires Local Session protocol revision ${LOCAL_SESSION_SOURCE_CONTROL_REVISION}.`,
    )
  }
  return match(channel)
    .with('git:change-request:panel', () =>
      requireHostUiArgCount(args, THREE_ARGUMENTS).pipe(
        Effect.zipRight(
          decoded(
            () => decodeSessionRequestArguments(...threeArguments(args)),
            (value) =>
              loadSessionChangeRequestPanel(value.sessionId, value.workingPath, value.requestUrl),
          ),
        ),
      ),
    )
    .with('git:change-request:merge-candidate', () =>
      requireHostUiArgCount(args, THREE_ARGUMENTS).pipe(
        Effect.zipRight(
          decoded(
            () => decodeSessionMergeArguments(...threeArguments(args)),
            (value) =>
              sessionChangeRequestMergeCandidate(value.sessionId, value.workingPath, value.payload),
          ),
        ),
      ),
    )
    .with('git:change-request:merge-confirmed', () =>
      requireHostUiArgCount(args, THREE_ARGUMENTS).pipe(
        Effect.zipRight(
          decoded(
            () => decodeSessionMergeArguments(...threeArguments(args)),
            (value) =>
              mergeConfirmedSessionChangeRequest(value.sessionId, value.workingPath, value.payload),
          ),
        ),
      ),
    )
    .with('git:session:verify-working-path', () =>
      requireHostUiArgCount(args, TWO_ARGUMENTS).pipe(
        Effect.zipRight(
          decoded(
            () => decodeSessionWorkingPathArguments(args[0], args[1]),
            (value) => verifySessionGitWorkingPath(value.sessionId, value.workingPath),
          ),
        ),
      ),
    )
    .with('source-control:patch-settings', () =>
      requireHostUiArgCount(args, 1).pipe(
        Effect.zipRight(
          decoded(
            () => decodeUnknownOrThrow(sourceControlSettingsPatchSchema, args[0]),
            (patch) =>
              Effect.tryPromise({
                try: () => sourceControlSettingsAccess().patch(patch),
                catch: (error) => error,
              }).pipe(
                Effect.as({ ok: true } as const),
                Effect.catchAll((error) =>
                  Effect.succeed({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                  } as const),
                ),
              ),
          ),
        ),
      ),
    )
    .with('git:session:record-outputs', () =>
      requireHostUiArgCount(args, TWO_ARGUMENTS).pipe(
        Effect.zipRight(
          decoded(
            () => decodeSessionGitOutputsArguments(args[0], args[1]),
            (value) => recordSessionGitOutputsOperation(value.sessionId, value.payload),
          ),
        ),
      ),
    )
    .exhaustive()
}
