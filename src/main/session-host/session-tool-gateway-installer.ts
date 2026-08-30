import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { dispatchNonHostUiLocalSessionCommand } from '../application/local-session-command-dispatcher'
import type { AgentKernelService } from '../ports/agent-kernel-service'
import type { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import type { AgentSteeringService } from '../ports/agent-steering-service'
import type { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import type { ExtensionManagerService } from '../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import type { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import type { ProviderService } from '../ports/provider-service'
import type { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import type { SessionControlRepository } from '../ports/session-control-repository'
import type { SessionControlRunExecutor } from '../ports/session-control-run-executor'
import type { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import type { SessionDelegationRepository } from '../ports/session-delegation-repository'
import type { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'
import type { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import type { SessionExportOperationRepository } from '../ports/session-export-operation-repository'
import type { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import type { SessionLifecycleIdentityService } from '../ports/session-lifecycle-identity-service'
import type { SessionLifecyclePreparationService } from '../ports/session-lifecycle-preparation-service'
import type { SessionLifecycleRepository } from '../ports/session-lifecycle-repository'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import type { SessionOrganizationRepository } from '../ports/session-organization-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionQueryRepository } from '../ports/session-query-repository'
import type { SessionReportDeliveryService } from '../ports/session-report-delivery-service'
import type { SessionReportRepository } from '../ports/session-report-repository'
import type { SessionRepository } from '../ports/session-repository'
import type { SessionWaitService } from '../ports/session-wait-service'
import type { SessionWorkspaceHandoffService } from '../ports/session-workspace-handoff-service'
import type { SettingsService } from '../services/settings-service'
import { resolveSessionToolAgentCaller } from './session-tool-agent-caller'
import { installSessionToolGateway } from './session-tool-gateway'

export { resolveSessionToolAgentCaller } from './session-tool-agent-caller'

type SessionToolDependencies =
  | SqlClient.SqlClient
  | AgentKernelService
  | AgentRunInterruptionService
  | AgentSteeringService
  | ExtensionLifecycleRepository
  | ExtensionManagerService
  | ExtensionProjectOverridesRepository
  | LocalSessionProfileRepository
  | SessionAuthorizationTargetRepository
  | SessionControlAttachmentService
  | SessionControlIdentityService
  | SessionControlOperationJournal
  | SessionControlRepository
  | SessionControlRunExecutor
  | SessionControlRunLifecycleRepository
  | SessionLifecycleIdentityService
  | SessionLifecyclePreparationService
  | SessionLifecycleRepository
  | SessionOrchestrationUpdateDeliveryService
  | SessionOrganizationRepository
  | SessionWorkspaceHandoffService
  | SessionQueryRepository
  | SessionReportRepository
  | SessionReportDeliveryService
  | SessionProjectionRepository
  | SessionRepository
  | SessionDelegationRepository
  | SessionDescendantRunRepository
  | SessionExportArtifactWriter
  | SessionExportOperationRepository
  | SessionExportResourceResolver
  | SessionWaitService
  | ProviderService
  | SettingsService

export const installAppSessionToolGateway = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const dependencies = yield* Effect.context<SessionToolDependencies>()
  const release = installSessionToolGateway(async (input) => {
    if (input.payload.contract === 'host-ui-v1') {
      throw new Error('The agent Session tool cannot invoke Host UI operations.')
    }
    const payload = input.payload
    const caller = await Effect.runPromise(
      resolveSessionToolAgentCaller(sql, {
        sessionId: input.sourceSessionId,
        runId: input.sourceRunId,
        workingDirectory: input.workingDirectory,
      }),
    )
    const command = Effect.suspend(
      (): Effect.Effect<LocalSessionCommandResult, unknown, SessionToolDependencies> =>
        dispatchNonHostUiLocalSessionCommand({
          caller,
          payload,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
    )
    return Effect.runPromise(command.pipe(Effect.provide(dependencies)))
  })
  yield* Effect.addFinalizer(() => Effect.sync(release))
})
