import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsRouteSurface } from '../-settings-route-surface'
import { SkillsRouteSurface } from '../-skills-route-surface'

let pathname = '/settings/general'

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>(input: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => T
  }) => input.select({ location: { pathname } }),
}))

vi.mock('@/features/settings/components', () => ({
  AppSettingsView: ({ activeTab }: { readonly activeTab: string }) => (
    <section>Settings tab: {activeTab}</section>
  ),
}))

vi.mock('@/features/skills/components', () => ({
  SkillsPanel: () => <section>Skills panel</section>,
}))

vi.mock('@/shell', () => ({
  SETTINGS_TABS: ['general', 'waggle', 'extensions', 'mcp', 'archived', 'connections'] as const,
}))

describe('settings route surfaces', () => {
  it('derives the settings tab from the current route when the route contains a tab segment', () => {
    pathname = '/settings/extensions'

    render(<SettingsRouteSurface tab="general" />)

    expect(screen.getByText('Settings tab: extensions')).toBeInTheDocument()
  })

  it('falls back to the route-provided settings tab for non-tab paths', () => {
    pathname = '/settings/unknown'

    render(<SettingsRouteSurface tab="waggle" />)

    expect(screen.getByText('Settings tab: waggle')).toBeInTheDocument()
  })

  it('wraps the skills panel in its route surface', () => {
    render(<SkillsRouteSurface />)

    expect(screen.getByText('Skills panel')).toBeInTheDocument()
  })
})
