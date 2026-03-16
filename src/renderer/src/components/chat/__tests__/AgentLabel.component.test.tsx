import { SupportedModelId } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentLabel } from '../AgentLabel'

describe('AgentLabel', () => {
  it('renders model name when only assistantModel provided', () => {
    render(<AgentLabel assistantModel={SupportedModelId('claude-sonnet-4-5')} />)
    expect(screen.getByText(/Claude/)).toBeInTheDocument()
  })

  it('renders waggle label and model when waggle provided', () => {
    render(
      <AgentLabel
        assistantModel={SupportedModelId('claude-sonnet-4-5')}
        waggle={{ agentLabel: 'Architect', agentColor: 'blue' }}
      />,
    )
    const el = screen.getByText(/Architect/)
    expect(el).toBeInTheDocument()
    expect(el.textContent).toContain('Architect')
    expect(el.textContent).toContain('Claude')
  })

  it('renders nothing when neither assistantModel nor waggle provided', () => {
    const { container } = render(<AgentLabel />)
    expect(container.firstChild).toBeNull()
  })

  it('applies correct waggle color class', () => {
    render(
      <AgentLabel
        assistantModel={SupportedModelId('claude-sonnet-4-5')}
        waggle={{ agentLabel: 'Reviewer', agentColor: 'amber' }}
      />,
    )
    const el = screen.getByText(/Reviewer/)
    expect(el.className).toContain('text-[#f5a623]')
  })
})
