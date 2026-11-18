import type { PreparationStatus, WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { actionRunsRefetchInterval } from '../useNativeActions'
import { preparationRefetchInterval } from '../useWorkspacePreparation'

function preparation(setup: PreparationStatus, cleanup: PreparationStatus = 'idle') {
  return fromPartial<WorkspacePreparation>({
    setup: fromPartial({ status: setup }),
    cleanup: fromPartial({ status: cleanup }),
  })
}

describe('Project Actions polling (B7/D9)', () => {
  it('polls runs only while one is active or the agent may start one', () => {
    expect(actionRunsRefetchInterval([{ status: 'running' }], false)).toBe(1_000)
    expect(actionRunsRefetchInterval([{ status: 'stopping' }], false)).toBe(1_000)
    expect(actionRunsRefetchInterval([{ status: 'completed' }], true)).toBe(3_000)
    expect(actionRunsRefetchInterval([{ status: 'completed' }], false)).toBe(false)
    expect(actionRunsRefetchInterval(undefined, false)).toBe(false)
  })

  it('polls preparation only while setup or cleanup runs, or the agent works', () => {
    expect(preparationRefetchInterval(preparation('running'), false)).toBe(1_000)
    expect(preparationRefetchInterval(preparation('succeeded', 'running'), false)).toBe(1_000)
    expect(preparationRefetchInterval(preparation('succeeded'), true)).toBe(3_000)
    expect(preparationRefetchInterval(preparation('succeeded'), false)).toBe(false)
    expect(preparationRefetchInterval(null, false)).toBe(false)
  })
})
