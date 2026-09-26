import * as Effect from 'effect/Effect'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'
import { runTranscriptTermRepairBackground } from './store/session-details/snapshot-transcript-term-projection'

export const startHostBackgroundServices = Effect.gen(function* () {
  yield* installAppSessionToolGateway
  yield* runSessionExportRecoveryBackground
  yield* runSessionSemanticDiscoveryBackground
  yield* runTranscriptTermRepairBackground
  yield* activateTrustedMainExtensionsForActiveProjectSafely()
})
