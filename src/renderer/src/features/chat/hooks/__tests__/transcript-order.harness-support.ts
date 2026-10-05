import { act } from '@testing-library/react'

/** How far the renderer's clock runs behind each event's Host timestamp. */
export const DEFAULT_LAG_MS = 50

export interface EndRunOptions {
  readonly continues?: string
  readonly followUp?: string
  /** Stop: the Run is interrupted. */
  readonly stop?: boolean
  /** The settlement (buffer clear, `run-completed`) reaches the renderer only on `settleRun`. */
  readonly settleLater?: boolean
  /** The shell's refetch on the settlement is still on its way (`refreshDetail` lands it). */
  readonly refetchLater?: boolean
}

/** `cached: false`: none while the detail loads; `stale`: the chat store's last detail of it. */
export interface ViewOptions {
  readonly cached?: boolean
  readonly stale?: boolean
}

export function inAct(run: () => void) {
  return act(async () => {
    run()
    await Promise.resolve()
  })
}

/** Lets React and the mocked IPC promises run until the transcript settles. */
export async function settle() {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
