import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { runNowWork } from '../scheduled-task-commands'
import type { ScheduledTaskPrincipal } from '../scheduled-task-principal'

function principal(kind: 'local-user' | 'profile' | 'session-agent') {
  return fromPartial<ScheduledTaskPrincipal>({ creator: { kind } })
}

describe('runNowWork', () => {
  it('makes a Run now the work of whoever asked for it', () => {
    expect(runNowWork(principal('local-user'))).toBe('person')
    expect(runNowWork(principal('session-agent'))).toBe('agents')
    expect(runNowWork(principal('profile'))).toBe('agents')
  })
})
