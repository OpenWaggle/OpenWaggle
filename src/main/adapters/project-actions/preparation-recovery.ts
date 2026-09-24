import type { PreparationPhase } from '@shared/types/workspace-preparation'
import type { PreparationPersistence } from './preparation-persistence'

export async function recoverPreparationAfterHostLoss(persistence: PreparationPersistence) {
  for (const state of await persistence.list()) {
    if (state.setup.status !== 'running' && state.cleanup.status !== 'running') continue
    const interrupt = (phase: PreparationPhase) =>
      state[phase].status === 'running'
        ? {
            ...state[phase],
            status: 'failed' as const,
            finishedAt: Date.now(),
            error:
              'The owning Host stopped during preparation. Retry explicitly after checking retained output.',
          }
        : state[phase]
    await persistence.write(
      {
        ...state,
        revision: state.revision + 1,
        setup: interrupt('setup'),
        cleanup: interrupt('cleanup'),
      },
      state.revision,
    )
  }
}
