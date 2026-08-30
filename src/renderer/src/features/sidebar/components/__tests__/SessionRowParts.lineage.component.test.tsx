import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionLineageIndicator } from '../SessionRowSecondLine'

function session(lineage: SessionSummary['lineage']): SessionSummary {
  return {
    id: SessionId('session-target'),
    title: 'Target Session',
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    ...(lineage ? { lineage } : {}),
  }
}

function renderIndicator(target: SessionSummary) {
  return render(<SessionLineageIndicator session={target} />)
}

describe('Session row lineage glyphs', () => {
  it('names a Queen and includes its direct Worker count', () => {
    renderIndicator(session({ role: 'queen', directWorkerCount: 2, activeDirectWorkerCount: 1 }))

    expect(screen.getByRole('img', { name: 'Queen Session · 2 direct Workers' })).toHaveAttribute(
      'title',
      'Queen Session · 2 direct Workers',
    )
  })

  it('names a Worker and its parent Queen', () => {
    renderIndicator(
      session({
        role: 'worker',
        parentSessionId: SessionId('session-queen'),
        parentTitle: 'Release Queen',
        directWorkerCount: 0,
        activeDirectWorkerCount: 0,
      }),
    )

    expect(
      screen.getByRole('img', { name: 'Worker Session · Parent: Release Queen' }),
    ).toHaveAttribute('title', 'Worker Session · Parent: Release Queen')
  })
})
