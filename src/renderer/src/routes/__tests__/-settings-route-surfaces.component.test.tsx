import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsRouteSurface } from '../-settings-route-surface'
import { SkillsRouteSurface } from '../-skills-route-surface'

interface RouterState {
  readonly location: { readonly pathname: string }
}

const routeMocks = vi.hoisted(() => ({ pathname: '/settings/general' }))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>(input: { readonly select: (state: RouterState) => T }) =>
    input.select({ location: { pathname: routeMocks.pathname } }),
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

describe('settings and skills route surfaces', () => {
  beforeEach(() => {
    routeMocks.pathname = '/settings/general'
  })

  it('derives the settings tab from the route tab segment', async () => {
    routeMocks.pathname = '/settings/extensions'

    render(<SettingsRouteSurface tab="general" />)

    expect(await screen.findByText('Settings tab: extensions')).toBeInTheDocument()
  })

  it('falls back to the provided settings tab for non-tab paths', async () => {
    routeMocks.pathname = '/settings/unknown'

    render(<SettingsRouteSurface tab="waggle" />)

    expect(await screen.findByText('Settings tab: waggle')).toBeInTheDocument()
  })

  it('wraps the skills panel', () => {
    render(<SkillsRouteSurface />)

    expect(screen.getByText('Skills panel')).toBeInTheDocument()
  })
})
