import type { AgentDefinitionLineageFacts } from './agent-definition'
import type { HiveNextActorLineageFacts } from './hive-next-actor'

/** What a parent Session's summary says about the Workers below it (ADR 0063). */
export interface WorkerRunLineageFacts {
  /**
   * Workers below this Session, at any depth and pinned or not, with an active or connecting Run.
   * Counted by the Host over the whole subtree; absent for a Session with no Workers.
   */
  readonly runningWorkerCount?: number
  /** When the last Run of any Worker below this Session ended, for Done below. */
  readonly workersLastRunEndedAt?: number
}

/** The lineage facts a Session summary carries besides its role and parent (ADR 0059, 0063). */
export interface SessionLineageFacts
  extends HiveNextActorLineageFacts, AgentDefinitionLineageFacts, WorkerRunLineageFacts {}
