import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTurnFoldStore } from '../../state/turn-fold-store'
import { TurnFoldRow } from '../TurnFoldRow'

/** Passthrough spy: renders the real fallback while capturing surface inputs. */
const surfaceInputs: Array<{ surface: string; status: { label: string; tone: string } }> = []
vi.mock('@/features/extensions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/extensions')>()
  return {
    ...actual,
    ExtensionAgentLoopSurface: (props: {
      fallback: React.ReactNode
      input: { surface: string; status: { label: string; tone: string } }
    }) => {
      surfaceInputs.push(props.input)
      return <>{props.fallback}</>
    },
  }
})

function renderRow(props: Partial<Parameters<typeof TurnFoldRow>[0]> = {}) {
  const onToggleTurnFold = vi.fn()
  render(
    <TurnFoldRow
      row={{
        type: 'turn-fold',
        id: 'turn-fold:u1',
        turnKey: 'u1',
        label: 'Worked for 12s',
        durationMs: 12_000,
        interrupted: false,
      }}
      sessionId="session-1"
      extensions={{ registry: null, projectPaths: [] }}
      onToggleTurnFold={onToggleTurnFold}
      {...props}
    />,
  )
  return onToggleTurnFold
}

describe('TurnFoldRow', () => {
  it('renders the fold label and toggles on click', () => {
    const onToggleTurnFold = renderRow()
    const fold = screen.getByTestId('turn-fold-row')
    expect(fold).toHaveTextContent('Worked for 12s')
    expect(fold).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(fold)
    expect(onToggleTurnFold).toHaveBeenCalledWith('u1')
  })

  it('shows the expanded state from the fold store', () => {
    useTurnFoldStore.setState((state) => {
      const next = new Map(state.expandedTurnKeysBySessionId)
      next.set('session-1', new Set(['u1']))
      return { expandedTurnKeysBySessionId: next }
    })
    try {
      renderRow()
      expect(screen.getByTestId('turn-fold-row')).toHaveAttribute('aria-expanded', 'true')
    } finally {
      useTurnFoldStore.setState((state) => {
        const next = new Map(state.expandedTurnKeysBySessionId)
        next.delete('session-1')
        return { expandedTurnKeysBySessionId: next }
      })
    }
  })

  it('passes an interrupted tone for interrupted turns', () => {
    renderRow({
      row: {
        type: 'turn-fold',
        id: 'turn-fold:u2',
        turnKey: 'u2',
        label: 'You stopped after 3s',
        durationMs: 3_000,
        interrupted: true,
      },
    })
    expect(screen.getByTestId('turn-fold-row')).toHaveTextContent('You stopped after 3s')
  })

  it('routes settled and interrupted tones through the extension status surface', () => {
    const { unmount } = render(
      <TurnFoldRow
        row={{
          type: 'turn-fold',
          id: 'turn-fold:u3',
          turnKey: 'u3',
          label: 'Worked',
          durationMs: null,
          interrupted: false,
        }}
        sessionId="session-1"
        extensions={{ registry: null, projectPaths: [] }}
        onToggleTurnFold={vi.fn()}
      />,
    )
    expect(surfaceInputs[0]?.status.tone).toBe('success')
    unmount()

    renderRow({
      row: {
        type: 'turn-fold',
        id: 'turn-fold:u4',
        turnKey: 'u4',
        label: 'You stopped',
        durationMs: null,
        interrupted: true,
      },
    })
    expect(surfaceInputs.at(-1)?.status.tone).toBe('warning')
  })
})
