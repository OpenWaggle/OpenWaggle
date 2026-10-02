import * as Effect from 'effect/Effect'
import { runSessionScratchSweepBackground } from './adapters/session-scratch-sweep-background'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { installSessionTitleWorker } from './application/session-title-scheduler'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'
import { runTranscriptTermRepairBackground } from './store/session-details/snapshot-transcript-term-projection'

export const startHostBackgroundServices = Effect.gen(function* () {
  yield* installAppSessionToolGateway
  yield* runSessionExportRecoveryBackground
  yield* runSessionScratchSweepBackground
  yield* runSessionSemanticDiscoveryBackground
  yield* runTranscriptTermRepairBackground
  yield* installSessionTitleWorker
  yield* activateTrustedMainExtensionsForActiveProjectSafely()
})
