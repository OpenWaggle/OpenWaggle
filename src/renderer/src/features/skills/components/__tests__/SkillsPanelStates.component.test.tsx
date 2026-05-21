import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptySkillsState, NoProjectState } from '../SkillsPanelStates'

describe('SkillsPanelStates', () => {
  it('explains that project selection is required before skills can be managed', () => {
    render(<NoProjectState />)

    expect(screen.getByText('No project selected')).toBeInTheDocument()
    expect(
      screen.getByText('Select a project folder to manage AGENTS.md and project skills.'),
    ).toBeInTheDocument()
  })

  it('explains which project skill directories are empty', () => {
    render(<EmptySkillsState />)

    expect(
      screen.getByText('No skills found under `.openwaggle/skills` or `.agents/skills`.'),
    ).toBeInTheDocument()
  })
})
