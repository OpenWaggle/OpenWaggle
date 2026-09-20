/** Turn-checkpoint schema migrations (see store/turn-checkpoints.ts). */

export const TURN_CHECKPOINT_SNAPSHOT_REF_MIGRATION = {
  id: 21,
  name: 'turn-checkpoint-snapshot-ref',
  statements: [`ALTER TABLE turn_checkpoints ADD COLUMN snapshot_ref TEXT`],
} as const

export const TURN_CHECKPOINT_ANCHOR_NODE_MIGRATION = {
  id: 23,
  name: 'turn-checkpoint-anchor-node',
  statements: [`ALTER TABLE turn_checkpoints ADD COLUMN anchor_node_id TEXT`],
} as const

export const TURN_CHECKPOINT_STARTED_AT_MIGRATION = {
  id: 28,
  name: 'turn-checkpoint-started-at',
  skipIfColumn: { table: 'turn_checkpoints', column: 'started_at' },
  statements: [`ALTER TABLE turn_checkpoints ADD COLUMN started_at INTEGER`],
} as const
