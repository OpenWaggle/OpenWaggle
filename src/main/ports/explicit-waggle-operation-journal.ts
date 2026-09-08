import type { AgentSendReport } from '@shared/types/agent'
import type { LocalSessionWaggleCommandPayload } from '@shared/types/local-session-waggle'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export type ExplicitWaggleRequest = Extract<
  LocalSessionWaggleCommandPayload,
  { readonly contract: 'session-waggle-v1' }
>['request']

export interface ExplicitWaggleOperationInput {
  readonly callerId: string
  readonly request: ExplicitWaggleRequest
}

export type ExplicitWaggleOperationClaim =
  | { readonly status: 'claimed' }
  | { readonly status: 'pending'; readonly replayed: true }
  | { readonly status: 'completed'; readonly replayed: true; readonly report: AgentSendReport }

export interface ExplicitWaggleOperationJournalShape {
  readonly claim: (
    input: ExplicitWaggleOperationInput,
  ) => Effect.Effect<ExplicitWaggleOperationClaim, SessionControlRepositoryError>
  readonly complete: (
    input: ExplicitWaggleOperationInput & { readonly report: AgentSendReport },
  ) => Effect.Effect<void, SessionControlRepositoryError>
}

export class ExplicitWaggleOperationJournal extends Context.Tag(
  '@openwaggle/ExplicitWaggleOperationJournal',
)<ExplicitWaggleOperationJournal, ExplicitWaggleOperationJournalShape>() {}
