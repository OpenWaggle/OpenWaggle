import * as Effect from 'effect/Effect'
import { migrateLegacyProviderCredentialsOnHostStart } from './adapters/pi/pi-legacy-provider-credentials'
import { runSessionScratchSweepBackground } from './adapters/session-scratch-sweep-background'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { migrateLegacyProviderReferences } from './adapters/sqlite-legacy-provider-rename-migration'
import { migrateLegacyThinkingLevels } from './adapters/sqlite-legacy-thinking-level-migration'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runFollowUpEditHoldExpiryBackground } from './application/follow-up-edit-hold-expiry'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { installSessionTitleWorker } from './application/session-title-scheduler'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'
import { runTranscriptTermRepairBackground } from './store/session-details/snapshot-transcript-term-projection'
import { runUsageStatisticsReporterBackground } from './usage-statistics/usage-statistics-reporter-background'

export const startHostBackgroundServices = Effect.gen(function* () {
  // Before anything reads a Session's thinking level or starts a Run.
  yield* migrateLegacyThinkingLevels
  // Before anything resolves a stored model reference or provider credential (Pi 1.0.3 renamed
  // `azure-openai-responses` to `azure` without migrating them).
  yield* migrateLegacyProviderReferences
  yield* migrateLegacyProviderCredentialsOnHostStart
  yield* installAppSessionToolGateway
  yield* runSessionExportRecoveryBackground
  yield* runSessionScratchSweepBackground
  yield* runFollowUpEditHoldExpiryBackground
  yield* runSessionSemanticDiscoveryBackground
  yield* runTranscriptTermRepairBackground
  yield* runUsageStatisticsReporterBackground
  yield* installSessionTitleWorker
  yield* activateTrustedMainExtensionsForActiveProjectSafely()
})
