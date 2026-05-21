import { SupportedModelId } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TurnDivider } from '../TurnDivider'
import { WaggleBeeIcon } from '../waggle-bee-icon'

describe('Waggle indicators', () => {
  it('renders turn labels with agent model metadata', () => {
    render(
      <TurnDivider
        turnNumber={1}
        agentLabel="Reviewer"
        agentColor="blue"
        agentModel={SupportedModelId('openai/gpt-5.5')}
      />,
    )

    expect(screen.getByText('Turn 2: Reviewer')).toBeInTheDocument()
    expect(screen.getByText(/GPT 5.5/)).toBeInTheDocument()
  })

  it('renders the bee icon as decorative svg', () => {
    const { container } = render(<WaggleBeeIcon className="size-4" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
