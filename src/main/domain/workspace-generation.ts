import { matchBy } from '@diegogbrisa/ts-match'

/** A folder as seen by `lstat` (bigint), recorded so a later check can tell it is the same one. */
export interface WorkspaceDirectoryIdentity {
  /**
   * `st_dev`. macOS assigns it when it mounts a volume, and it changes across reboots (observed
   * 16777230 -> 16777233 -> 16777230), so a recorded value is only compared when birth time is
   * unknown. Otherwise it is kept for diagnosis.
   */
  readonly device: string
  readonly inode: string
  /** `birthtimeNs`. `0` when the filesystem does not record a birth time. */
  readonly birthtime: string
}

const UNKNOWN_BIRTHTIME = '0'

/**
 * Whether a live identity is the folder recorded in an earlier Host process or boot. The caller
 * fixes the path; inode plus nanosecond birth time tell a replacement at that path apart. Where
 * the filesystem records no birth time, the device number is the only extra signal, so it is
 * compared in that case alone.
 */
export function isSameDurableDirectoryIdentity(
  current: WorkspaceDirectoryIdentity | null | undefined,
  recorded: WorkspaceDirectoryIdentity,
) {
  if (!current) return false
  if (current.inode !== recorded.inode || current.birthtime !== recorded.birthtime) return false
  return recorded.birthtime !== UNKNOWN_BIRTHTIME || current.device === recorded.device
}

/** Why a worktree does or does not still match the folder its preparation was captured in. */
export type WorkspaceGenerationCheck =
  | { readonly status: 'current' }
  | { readonly status: 'unrecorded'; readonly workspacePath: string }
  | { readonly status: 'awaiting-birth'; readonly workspacePath: string }
  | {
      readonly status: 'unreadable'
      readonly workspacePath: string
      readonly recorded: WorkspaceDirectoryIdentity
    }
  | {
      readonly status: 'replaced'
      readonly workspacePath: string
      readonly recorded: WorkspaceDirectoryIdentity
      readonly observed: WorkspaceDirectoryIdentity
    }

export type WorkspaceGenerationMismatch = Exclude<
  WorkspaceGenerationCheck,
  { readonly status: 'current' }
>

function describeBirthtime(birthtime: string) {
  if (birthtime === UNKNOWN_BIRTHTIME) return 'unknown creation time'
  const NANOSECONDS_PER_MILLISECOND = 1_000_000n
  return `created ${new Date(Number(BigInt(birthtime) / NANOSECONDS_PER_MILLISECOND)).toISOString()}`
}

function describeIdentity(identity: WorkspaceDirectoryIdentity) {
  return `inode ${identity.inode}, ${describeBirthtime(identity.birthtime)}`
}

/** Removing the folder is what lets the Session offer Recreate worktree or Use current checkout. */
const MOVE_ASIDE =
  'move that folder out of the way; this Session then offers Recreate worktree or Use current checkout'

/**
 * What went wrong, and how to recover when a run needs the folder. Callers with a different
 * remedy, such as worktree removal, use `problem` alone. The raw identities, device included, go
 * to the Host log rather than the message.
 */
export function describeWorkspaceGenerationMismatch(check: WorkspaceGenerationMismatch): {
  readonly problem: string
  readonly recovery: string
} {
  return matchBy(check, 'status')
    .with('replaced', ({ workspacePath, recorded, observed }) => ({
      problem: `${workspacePath} is a different folder from the one that was prepared (prepared: ${describeIdentity(recorded)}; found: ${describeIdentity(observed)})`,
      recovery: `If you moved or renamed the original folder, move it back. Otherwise ${MOVE_ASIDE}.`,
    }))
    .with('unreadable', ({ workspacePath }) => ({
      problem: `${workspacePath} is missing or is not a plain folder`,
      recovery: `If you moved or renamed it, move it back. Otherwise ${MOVE_ASIDE}.`,
    }))
    .with('awaiting-birth', ({ workspacePath }) => ({
      problem: `the preparation was reset for a new worktree and has not recorded ${workspacePath} yet`,
      recovery: `To start over, ${MOVE_ASIDE}.`,
    }))
    .with('unrecorded', ({ workspacePath }) => ({
      problem: `the preparation has no record of the folder ${workspacePath}`,
      recovery: `To start over, ${MOVE_ASIDE}.`,
    }))
    .exhaustive()
}
