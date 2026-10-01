import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionRowSecondLine } from '../SessionRowSecondLine'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId('session-target'),
    title: 'Target Session',
    projectPath: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function renderLine(target: SessionSummary) {
  return render(
    <SessionRowSecondLine
      session={target}
      stateLabel="Idle"
      stateColorVar="var(--color-neutral)"
      phaseLabel={null}
      projectLabel=""
      shortcutIndex={null}
    />,
  )
}

describe('Session row Follow-up edit wait', () => {
  it('says the Session is waiting on the user’s edit while a hold is live', () => {
    renderLine(session({ followUpEditHeldAt: 10 }))

    expect(screen.getByText('Waiting on your edit')).toBeInTheDocument()
  })

  it('shows nothing extra without a hold', () => {
    renderLine(session())

    expect(screen.queryByText('Waiting on your edit')).not.toBeInTheDocument()
  })
})
