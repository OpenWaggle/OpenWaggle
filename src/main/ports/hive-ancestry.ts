import { Context, type Effect } from 'effect'

/** Read-only Spawn-lineage facts the Hive ancestor refresh needs (ADR 0065). */
export interface HiveAncestryShape {
  /**
   * Every Spawn-lineage ancestor of a Session, nearest first, up to its Hive root; empty for a
   * root or for retired task-runner lineage, which is no Hive.
   */
  readonly ancestorsOf: (sessionId: string) => Effect.Effect<readonly string[], Error>
}

export class HiveAncestry extends Context.Tag('@openwaggle/HiveAncestry')<
  HiveAncestry,
  HiveAncestryShape
>() {}
