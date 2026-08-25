/**
 * The single owner of the Turn checkpoint ref namespace.
 *
 * Turn capture anchors every snapshot commit under this namespace so git cannot gc it, and the
 * session death path deletes the namespace so those objects do not stay reachable forever in
 * the user's repository. Two modules therefore need the same strings, and they must not derive
 * them independently: a namespace defined twice is a namespace that gets renamed in one place.
 */
const TURN_CHECKPOINT_REF_PREFIX = 'refs/openwaggle/turn-checkpoints'

/** Every checkpoint ref belonging to one session lives under this namespace. */
export function turnCheckpointSessionNamespace(sessionId: string): string {
  return `${TURN_CHECKPOINT_REF_PREFIX}/${sessionId}`
}

/** The anchor ref for one captured turn. */
export function turnCheckpointRef(sessionId: string, turnId: string): string {
  return `${turnCheckpointSessionNamespace(sessionId)}/${turnId}`
}
