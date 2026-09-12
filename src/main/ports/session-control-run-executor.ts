import type { RunId, SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionControlIntentSnapshot } from '../domain/session-control/message-aggregate'
import type { SessionControlTerminalRunStatus } from './session-control-run-lifecycle-repository'

export interface SessionControlRunExecutionInput {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly intent: SessionControlIntentSnapshot
  readonly controller: AbortController
}

export interface SessionControlRunExecutionResult {
  readonly terminalStatus: SessionControlTerminalRunStatus
  readonly finalResponse?: string
}

export interface SessionControlRunExecutorShape {
  readonly execute: (
    input: SessionControlRunExecutionInput,
  ) => Effect.Effect<SessionControlRunExecutionResult, Error>
}

export class SessionControlRunExecutor extends Context.Tag('@openwaggle/SessionControlRunExecutor')<
  SessionControlRunExecutor,
  SessionControlRunExecutorShape
>() {}
