import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'

export interface SessionToolGatewayInput {
  readonly sourceSessionId: string
  readonly sourceRunId: string
  readonly workingDirectory: string
  readonly projectPath?: string
  readonly payload: LocalSessionCommandPayload
  readonly signal?: AbortSignal
}

export type SessionToolGateway = (
  input: SessionToolGatewayInput,
) => Promise<LocalSessionCommandResult>

let installedGateway: SessionToolGateway | null = null

export function installSessionToolGateway(gateway: SessionToolGateway) {
  installedGateway = gateway
  return () => {
    if (installedGateway === gateway) installedGateway = null
  }
}

export function executeSessionToolCommand(input: SessionToolGatewayInput) {
  if (!installedGateway) {
    throw new Error('The OpenWaggle Sessions tool gateway is not available.')
  }
  return installedGateway(input)
}
