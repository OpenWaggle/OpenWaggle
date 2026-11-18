import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { SessionListItem } from '../SessionListItem'
import {
  actions,
  qaOne,
  renderRow,
  SESSION_ID,
  session,
} from './SessionListItem.two-line.test-utils'

describe('a parent row and its Running Workers', () => {
  it('reads Working while the Queen is idle and her Workers run, then Done below (ADR 0065)', () => {
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map([[SESSION_ID, 1_000]]),
      phases: new Map(),
    })
    const queen = (facts: { runningWorkerCount: number; workersLastRunEndedAt?: number }) =>
      session({
        lineage: { role: 'queen', directWorkerCount: 3, activeDirectWorkerCount: 3, ...facts },
      })
    const row = (target: ReturnType<typeof session>) => (
      <ul>
        <SessionListItem session={target} actions={actions()} />
      </ul>
    )
    const { rerender } = renderRow(queen({ runningWorkerCount: 2 }))

    expect(qaOne('sidebar-row-state')).toHaveTextContent('Working')
    expect(
      screen.getByRole('img', { name: 'Queen Session · 3 direct Workers · 2 Workers running' }),
    ).toBeVisible()

    rerender(row(queen({ runningWorkerCount: 0, workersLastRunEndedAt: 2_000 })))
    expect(qaOne('sidebar-row-state')).toHaveTextContent('Done')

    rerender(row(queen({ runningWorkerCount: 0, workersLastRunEndedAt: 500 })))
    expect(qaOne('sidebar-row-state')).toBeNull()
  })
})
