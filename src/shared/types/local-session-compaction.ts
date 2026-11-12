import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from './local-session-protocol'

type LocalSessionCompactionContract = 'local-compaction-v1' | 'local-compaction-cancel-v1'

export type LocalSessionCompactionCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: LocalSessionCompactionContract }
>

export type LocalSessionCompactionCommandResult = Extract<
  LocalSessionCommandResult,
  { readonly contract: LocalSessionCompactionContract }
>
