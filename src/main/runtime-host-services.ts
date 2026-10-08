import * as Effect from 'effect/Effect'
import { migrateOpenWaggleMcpFilesAtHostStart } from './adapters/pi/mcp/openwaggle-mcp-migration'
import { migrateLegacyProviderCredentialsOnHostStart } from './adapters/pi/pi-legacy-provider-credentials'
import { runSessionScratchSweepBackground } from './adapters/session-scratch-sweep-background'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { migrateLegacyProviderReferences } from './adapters/sqlite-legacy-provider-rename-migration'
import { migrateLegacyThinkingLevels } from './adapters/sqlite-legacy-thinking-level-migration'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runFollowUpEditHoldExpiryBackground } from './application/follow-up-edit-hold-expiry'
import {
  type DiscoveredSessionCreator,
  runPiSessionDiscoveryBackground,
} from './application/pi-session-discovery'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { installSessionTitleWorker } from './application/session-title-scheduler'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'
import { runTranscriptTermRepairBackground } from './store/session-details/snapshot-transcript-term-projection'
import { runUsageStatisticsReporterBackground } from './usage-statistics/usage-statistics-reporter-background'

export interface HostServiceOptions<R> {
  /**
   * The Session Host's lifecycle create, which Pi session discovery lists sessions through. The
   * Session Host entry passes it in, because the lifecycle's dispatcher depends on this runtime.
   * Without it discovery does not run.
   */
  readonly createDiscoveredSession?: DiscoveredSessionCreator<R>
}

export function startHostBackgroundServices<R = never>(options: HostServiceOptions<R> = {}) {
  return Effect.gen(function* () {
    // Before anything reads a Session's thinking level or starts a Run.
    yield* migrateLegacyThinkingLevels
    // Before anything resolves a stored model reference or provider credential (Pi 1.0.3 renamed
    // `azure-openai-responses` to `azure` without migrating them).
    yield* migrateLegacyProviderReferences
    yield* migrateLegacyProviderCredentialsOnHostStart
    // Before Settings, the CLI, or a Run reads MCP configuration (ADR 0048 migration).
    yield* Effect.promise(() => migrateOpenWaggleMcpFilesAtHostStart())
    yield* installAppSessionToolGateway
    yield* runSessionExportRecoveryBackground
    yield* runSessionScratchSweepBackground
    yield* runFollowUpEditHoldExpiryBackground
    if (options.createDiscoveredSession) {
      yield* runPiSessionDiscoveryBackground(options.createDiscoveredSession)
    }
    yield* runSessionSemanticDiscoveryBackground
    yield* runTranscriptTermRepairBackground
    yield* runUsageStatisticsReporterBackground
    yield* installSessionTitleWorker
    yield* activateTrustedMainExtensionsForActiveProjectSafely()
  })
}
