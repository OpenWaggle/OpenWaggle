import { match } from '@diegogbrisa/ts-match'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import { requireHostUiArgCount, TWO_ARGUMENTS } from './host-ui-operation-validation'
import { listWorktreeInventory } from './worktree-inventory'
import {
  acknowledgeAutomaticWorktreeRemovalOperation,
  archiveAndRemoveWorktreeOperation,
  measureWorktreeOperation,
  readAutomaticWorktreeRemovalLogOperation,
} from './worktree-operations'

type WorktreesChannel = Extract<HostBackedGuiChannel, `worktrees:${string}`>

export function isHostUiWorktreesChannel(
  channel: HostBackedGuiChannel,
): channel is WorktreesChannel {
  return channel.startsWith('worktrees:')
}

/** Settings > Worktrees across every project (ADR 0060). */
export function dispatchHostUiWorktreesOperation(
  channel: WorktreesChannel,
  args: readonly unknown[],
) {
  return match(channel)
    .with('worktrees:inventory', () =>
      requireHostUiArgCount(args, 0).pipe(Effect.zipRight(listWorktreeInventory())),
    )
    .with('worktrees:measure', () =>
      requireHostUiArgCount(args, TWO_ARGUMENTS).pipe(
        Effect.zipRight(measureWorktreeOperation(args[0], args[1])),
      ),
    )
    .with('worktrees:archive-and-remove', () =>
      requireHostUiArgCount(args, TWO_ARGUMENTS).pipe(
        Effect.zipRight(archiveAndRemoveWorktreeOperation(args[0], args[1])),
      ),
    )
    .with('worktrees:automatic-removal-log', () =>
      requireHostUiArgCount(args, 0).pipe(
        Effect.zipRight(readAutomaticWorktreeRemovalLogOperation()),
      ),
    )
    .with('worktrees:acknowledge-automatic-removal', () =>
      requireHostUiArgCount(args, 1).pipe(
        Effect.zipRight(acknowledgeAutomaticWorktreeRemovalOperation(args[0])),
      ),
    )
    .exhaustive()
}
