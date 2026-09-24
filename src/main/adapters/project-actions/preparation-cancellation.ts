import type { PreparationPhase } from '@shared/types/workspace-preparation'

/** Cancellation targets one exact attempt and waits for its owned process tree to drain. */
export class PreparationCancellation {
  private readonly active = new Map<
    string,
    {
      readonly phase: PreparationPhase
      readonly controller: AbortController
      readonly finished: PromiseWithResolvers<void>
      attemptId: string | null
    }
  >()

  begin(workspaceId: string, phase: PreparationPhase) {
    const entry: {
      phase: PreparationPhase
      controller: AbortController
      finished: PromiseWithResolvers<void>
      attemptId: string | null
    } = {
      phase,
      controller: new AbortController(),
      finished: Promise.withResolvers<void>(),
      attemptId: null,
    }
    this.active.set(workspaceId, entry)
    return {
      signal: entry.controller.signal,
      started: (attemptId: string | null) => {
        entry.attemptId = attemptId
      },
      finish: () => {
        if (this.active.get(workspaceId) === entry) this.active.delete(workspaceId)
        entry.finished.resolve()
      },
    }
  }

  async stopSetup(workspaceId: string, attemptId: string) {
    const entry = this.active.get(workspaceId)
    if (!entry) return false
    if (entry.phase !== 'setup' || entry.attemptId !== attemptId)
      throw new Error('The setup attempt changed. Refresh before stopping it.')
    entry.controller.abort(new Error('Workspace setup stopped. Retry setup or Continue anyway.'))
    await entry.finished.promise
    return true
  }
}
