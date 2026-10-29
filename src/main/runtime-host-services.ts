import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import {
  migrateOpenWaggleMcpFilesAtHostStart,
  migrateOpenWaggleMcpSignInsAfterHostStart,
  stopOpenWaggleMcpSignInMigration,
} from './adapters/pi/mcp/openwaggle-mcp-migration'
import { migrateLegacyProviderCredentialsOnHostStart } from './adapters/pi/pi-legacy-provider-credentials'
import { runSessionScratchSweepBackground } from './adapters/session-scratch-sweep-background'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { migrateLegacyProviderReferences } from './adapters/sqlite-legacy-provider-rename-migration'
import { migrateLegacyThinkingLevels } from './adapters/sqlite-legacy-thinking-level-migration'
import { runWalCheckpointBackground } from './adapters/sqlite-wal-checkpoint-background'
import { runAutomaticWorktreeRemovalBackground } from './application/automatic-worktree-removal'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { runFollowUpEditHoldExpiryBackground } from './application/follow-up-edit-hold-expiry'
import {
  type DiscoveredSessionCreator,
  runPiSessionDiscoveryBackground,
} from './application/pi-session-discovery'
import { runSessionExportRecoveryBackground } from './application/session-export-recovery'
import { installSessionTitleWorker } from './application/session-title-scheduler'
import { runScheduledTaskSchedulerBackground } from './session-host/scheduled-task-scheduler'
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

/**
 * Host services that must run before the Host serves its first client: the migrations every read
 * depends on, the session tool gateway, Follow-up edit-hold expiry and the Title worker (a Spawn or
 * Launch asks it for a title, and a request before it is installed is dropped). Anything that can
 * wait starts once the Host listens (`startHostServicesOnceListening`, A-F8).
 */
export function startHostBackgroundServices() {
  return Effect.gen(function* () {
    // SQLite checkpoints on a worker thread, not inside the Host's commits (#357). Not awaited:
    // until the worker reports ready the connection keeps checkpointing itself, as before.
    yield* Effect.forkScoped(runWalCheckpointBackground())
    // Before anything reads a Session's thinking level or starts a Run.
    yield* migrateLegacyThinkingLevels
    // Before anything resolves a stored model reference or provider credential (Pi 1.0.3 renamed
    // `azure-openai-responses` to `azure` without migrating them).
    yield* migrateLegacyProviderReferences
    yield* migrateLegacyProviderCredentialsOnHostStart
    // Before Settings, the CLI, or a Run reads MCP configuration (ADR 0051 migration). Files only:
    // old sign-ins read the keychain, which can stall for minutes, so they wait until the Host
    // serves clients (`startHostServicesAfterListening`).
    yield* Effect.promise(() => migrateOpenWaggleMcpFilesAtHostStart())
    yield* installAppSessionToolGateway
    yield* runFollowUpEditHoldExpiryBackground
    yield* installSessionTitleWorker
  })
}

/**
 * How long the background indexers wait after the Host listens. Transcript term repair and
 * semantic preparation run SQLite and embedding work on the Host's thread; on a freshly opened
 * 20k-node profile one pass stalled the loop for 6-11 s, before the Host listened and then before
 * it answered its first client. The window's and the CLI's first requests come first.
 */
export const BACKGROUND_INDEXING_START_DELAY = Duration.seconds(5)

function afterQuietStart<A, E, R>(indexer: Effect.Effect<A, E, R>) {
  return Effect.forkScoped(
    Effect.sleep(BACKGROUND_INDEXING_START_DELAY).pipe(Effect.zipRight(indexer)),
  )
}

/**
 * Host services that start once the Host serves clients, in the scope of the services above
 * (A-F8). None of them answers a client request: export recovery, the scratch sweep, the
 * scheduler (it settles interrupted firings before it forks), Pi session discovery, the Usage
 * statistics reporter, Automatic worktree removal, the background indexers after a quiet delay, and
 * trusted-main extension activation, which runs user code for as long as it takes.
 */
export function startHostServicesOnceListening<R = never>(options: HostServiceOptions<R> = {}) {
  return Effect.gen(function* () {
    yield* runSessionExportRecoveryBackground
    yield* runSessionScratchSweepBackground
    // After the tool gateway and title worker: a Launch schedule's Session gets its title.
    yield* runScheduledTaskSchedulerBackground
    if (options.createDiscoveredSession) {
      yield* runPiSessionDiscoveryBackground(options.createDiscoveredSession)
    }
    yield* runUsageStatisticsReporterBackground
    yield* runAutomaticWorktreeRemovalBackground
    yield* afterQuietStart(runTranscriptTermRepairBackground)
    yield* afterQuietStart(runSessionSemanticDiscoveryBackground)
    yield* activateTrustedMainExtensionsForActiveProjectSafely()
  })
}

/**
 * Host work that starts once the Host serves clients and that start never waits for: the MCP
 * sign-in migration, which reads the keychain. MCP connections and sign-ins wait for it instead.
 */
export function startHostServicesAfterListening() {
  return migrateOpenWaggleMcpSignInsAfterHostStart()
}

/**
 * At Host stop, before the stores close: the MCP sign-in migration writes nothing more, and what
 * it is writing gets a bounded time to finish.
 */
export function stopHostServicesAfterListening() {
  return stopOpenWaggleMcpSignInMigration()
}
