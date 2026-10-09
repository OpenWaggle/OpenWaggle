import * as Layer from 'effect/Layer'
import { PiSessionTranscriptRepairLive } from './adapters/pi/agent-kernel/snapshot-entry-id-repair'
import { PiSessionFilesLive } from './adapters/pi/pi-session-files'
import { PiThinkingLevelDefaultLive } from './adapters/pi/pi-thinking-level-default-service'
import { SqlitePiSessionDiscoveryRepositoryLive } from './adapters/sqlite-pi-session-discovery-repository'
import { SessionTitleServicesLive } from './runtime-session-title-services'

/** What projects a discovered Pi session's file into its Session (ADR 0051). */
export const PiSessionDiscoveryServicesLive = Layer.mergeAll(
  SqlitePiSessionDiscoveryRepositoryLive.pipe(Layer.provide(PiSessionTranscriptRepairLive)),
  PiSessionFilesLive,
)

/**
 * What a Run's refresh of a discovered Session reads before the Run starts (ADR 0051): the file,
 * then the model, thinking level, and name the Session continues with.
 */
export const PiSessionContinuationServicesLive = Layer.mergeAll(
  PiSessionDiscoveryServicesLive,
  PiThinkingLevelDefaultLive,
  SessionTitleServicesLive,
)
