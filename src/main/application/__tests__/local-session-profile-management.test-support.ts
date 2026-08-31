import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import type { LocalSessionProfileRepositoryShape } from '../../ports/local-session-profile-repository'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'

export const PROJECT_PATH = fs.realpathSync(os.tmpdir())

export function profileManagementRequest(
  command:
    | { readonly operation: 'list' }
    | {
        readonly operation: 'update'
        readonly profileName: string
        readonly capabilities: readonly ['sessions:read']
        readonly scope: { readonly projectPaths: readonly string[] }
        readonly authorizationCeiling: 'ask-for-approval'
      }
    | { readonly operation: 'revoke'; readonly profileName: string }
    | { readonly operation: 'rotate'; readonly profileName: string; readonly credential: string }
    | {
        readonly operation: 'create'
        readonly name: string
        readonly credential: string
        readonly capabilities: readonly ['sessions:read']
        readonly scope: { readonly projectPaths: readonly string[] }
        readonly authorizationCeiling: 'ask-for-approval'
      },
) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    command,
  } as const
}

export function localSessionProfileManagementTestLayer(
  executeManagement: (
    input: Parameters<LocalSessionProfileRepositoryShape['executeManagement']>[0],
  ) => Promise<LocalSessionProfileManagementResponse>,
  interrupt: () => Effect.Effect<{ readonly accepted: true }> = () =>
    Effect.succeed({ accepted: true }),
) {
  return Layer.mergeAll(
    Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(null),
      findById: () => Effect.succeed(null),
      recordAuthentication: () => Effect.void,
      executeManagement: (input) => Effect.promise(() => executeManagement(input)),
    }),
    Layer.succeed(AgentRunInterruptionService, { requestInterrupt: interrupt, interrupt }),
  )
}
