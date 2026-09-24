import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), manage: vi.fn() }))
vi.mock('../typed-ipc', () => ({ hostHandle: mocks.handle }))
vi.mock('../../application/action-management', () => ({ manageProjectActions: mocks.manage }))

import { registerProjectActionHandlers } from '../project-actions-handler'

describe('native action transport registration', () => {
  it('exposes one native boundary and removes the vendor importer and legacy writers', () => {
    mocks.manage.mockReturnValue(Effect.succeed({ type: 'runs', runs: [] }))
    registerProjectActionHandlers()
    expect(mocks.handle).toHaveBeenCalledTimes(1)
    expect(mocks.handle).toHaveBeenCalledWith('project-actions:manage', expect.any(Function))
  })
})
