import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentCustomInteractionComposerFallback } from '../AgentCustomInteractionComposerFallback'
import { AgentInteractionCard } from '../AgentInteractionCard'

function customInteraction() {
  return {
    interactionId: 'custom-interaction-1',
    sessionId: SessionId('session-1'),
    runId: 'run-1',
    kind: 'custom',
    customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    source: 'pi-ui',
    createdAt: 1,
    renderer: { kind: 'pi-tui-custom', supported: false },
  } as const
}

describe('AgentCustomInteractionComposerFallback', () => {
  it('lets users reject a custom interaction when no desktop renderer is available', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = customInteraction()

    render(
      <AgentCustomInteractionComposerFallback
        extensionProjectPaths={[]}
        extensionRegistry={null}
        interactions={[interaction]}
        onRespond={onRespond}
      />,
    )

    // Asserting a count would stay green if a raw identifier were appended to the label, so this
    // checks the identifier cannot appear anywhere in the rendered output instead.
    expect(screen.getAllByText('Custom interaction').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain(
      OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reject interaction' }))

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'custom', value: null })
  })

  it('keeps the fallback stack inside the composer column', () => {
    const { container } = render(
      <AgentCustomInteractionComposerFallback
        extensionProjectPaths={[]}
        extensionRegistry={null}
        interactions={[customInteraction()]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    // jsdom does no layout, so these pin the classes that stop an implicit grid track from growing
    // to its widest min-content child and pushing the card past the column.
    expect(container.firstElementChild).toHaveClass('grid', 'grid-cols-1', 'min-w-0')
    expect(container.querySelector('section')).toHaveClass('grid', 'grid-cols-1', 'min-w-0')
  })
})

describe('AgentInteractionCard layout', () => {
  it('wraps a long unbroken title and message inside the card', () => {
    const title = `Approve ${'unbroken'.repeat(40)}`
    const message = `/very/long/path/${'segment'.repeat(40)}`
    render(
      <AgentInteractionCard
        busy={false}
        extensionProjectPaths={[]}
        extensionRegistry={null}
        interaction={{
          interactionId: 'confirm-1',
          sessionId: SessionId('session-1'),
          runId: 'run-1',
          kind: 'confirm',
          source: 'pi-ui',
          createdAt: 1,
          purpose: 'user-input',
          title,
          message,
        }}
        submit={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const titles = screen.getAllByText(title)
    expect(titles.length).toBeGreaterThan(0)
    for (const element of titles) {
      expect(element).toHaveClass('wrap-anywhere')
    }
    expect(screen.getByText(message)).toHaveClass('wrap-anywhere')
  })

  it('keeps a select with a long choice inside the card', () => {
    // A native select's min-content width is its widest option, so an implicit grid track would
    // grow to it and push the card past the column.
    const choice = `/very/long/choice/${'segment'.repeat(40)}`
    render(
      <AgentInteractionCard
        busy={false}
        extensionProjectPaths={[]}
        extensionRegistry={null}
        interaction={{
          interactionId: 'select-1',
          sessionId: SessionId('session-1'),
          runId: 'run-1',
          kind: 'select',
          source: 'pi-ui',
          createdAt: 1,
          title: 'Pick a package',
          choices: [choice, 'short'],
        }}
        submit={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('combobox').parentElement).toHaveClass('grid', 'grid-cols-1', 'min-w-0')
  })
})
