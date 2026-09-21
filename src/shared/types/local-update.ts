import type { UpdateChannel } from './update-channel'

export const LOCAL_UPDATE_CONTRACT_VERSION = 1 as const

export type LocalUpdateRequest =
  | {
      readonly contractVersion: typeof LOCAL_UPDATE_CONTRACT_VERSION
      readonly operation: 'get-channel'
    }
  | {
      readonly contractVersion: typeof LOCAL_UPDATE_CONTRACT_VERSION
      readonly operation: 'set-channel'
      readonly channel: UpdateChannel
    }

export interface LocalUpdateResponse {
  readonly contractVersion: typeof LOCAL_UPDATE_CONTRACT_VERSION
  readonly updateChannel: UpdateChannel
}

export interface LocalUpdateCommandPayload {
  readonly contract: 'local-update-v1'
  readonly request: LocalUpdateRequest
}

export interface LocalUpdateCommandResult {
  readonly contract: 'local-update-v1'
  readonly response: LocalUpdateResponse
}
