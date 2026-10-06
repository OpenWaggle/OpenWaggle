import { act } from '@testing-library/react'
import type { HostModel } from './transcript-order.host-model'
import type { RunCompletedPayload } from './transcript-order.ipc-mock'

/*
 * Runs whose ids the Host settles under another id, or that never start: an agent-requested Waggle
 * after a classic Run (it settles as that Run), and a Run that fails before Pi starts; and a Run Pi
 * continues under its own id.
 */

interface RunKindDeps {
  readonly host: HostModel
  readonly notifySettled: (payload: Omit<RunCompletedPayload, 'sessionId'>) => Promise<void>
  readonly refreshDetail: () => Promise<void>
}

export function createRunKinds({ host, notifySettled, refreshDetail }: RunKindDeps) {
  return {
    /**
     * The Run ends and the Waggle its agent requested runs as `waggle-of-<runId>`; the Host then
     * settles the classic Run, naming it.
     */
    async endRunWithRequestedWaggle(answer: string) {
      let runId = ''
      act(() => {
        runId = host.finishRun()
        host.startRun(`waggle-of-${runId}`)
        host.answer(answer)
        host.finishRun()
        host.settleRun()
      })
      await notifySettled({ runId, terminalStatus: 'completed' })
      await refreshDetail()
    },
    /** Pi continues the Run under its id (`HostModel.continueRun`), a steer it took on the way. */
    continueRun: (options: { readonly compact?: boolean; readonly steer?: string } = {}) =>
      act(() => {
        host.continueRun(options.compact ?? false)
        if (options.steer) host.incorporateUser(options.steer)
      }),
    /** A Run that fails before Pi starts (an invalid model): its end, then its settlement. */
    async failBeforeStart(runId: string) {
      act(() => host.failBeforeStart(runId))
      await notifySettled({ runId, terminalStatus: 'failed' })
      await refreshDetail()
    },
  }
}
