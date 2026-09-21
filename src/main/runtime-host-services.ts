import * as Effect from 'effect/Effect'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { ActionRunService } from './ports/action-run-service'
import { WorkspacePreparationService } from './ports/workspace-preparation-service'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'

export const startHostBackgroundServices = Effect.gen(function* () {
  yield* (yield* WorkspacePreparationService).recoverAfterHostLoss
  yield* (yield* ActionRunService).recoverAfterHostLoss
  yield* installAppSessionToolGateway
  yield* runSessionExportRecoveryBackground
  yield* runSessionSemanticDiscoveryBackground
  yield* activateTrustedMainExtensionsForActiveProjectSafely()
})
