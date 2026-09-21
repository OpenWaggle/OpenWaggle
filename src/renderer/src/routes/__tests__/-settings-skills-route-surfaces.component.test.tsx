import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsRouteSurface } from '../-settings-route-surface'

type SettingsTab =
  | 'general'
  | 'configuration'
  | 'waggle'
  | 'extensions'
  | 'mcp'
  | 'personalization'
  | 'git'
  | 'environments'
  | 'worktrees'
  | 'archived'
  | 'connections'
  | 'skills'
  | 'agents'

const routeMocks = vi.hoisted(() => ({ pathname: '/settings/general' }))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>(input: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => T
  }) => input.select({ location: { pathname: routeMocks.pathname } }),
}))

vi.mock('@/features/settings/components', () => ({
  AppSettingsView: ({ activeTab }: { readonly activeTab: SettingsTab }) => (
    <section>Settings tab: {activeTab}</section>
  ),
}))

vi.mock('@/shell', () => ({
  SETTINGS_TABS: [
    'general',
    'waggle',
    'extensions',
    'skills',
    'agents',
    'mcp',
    'archived',
    'connections',
  ] as const,
}))

describe('settings and skills route surfaces', () => {
  beforeEach(() => {
    routeMocks.pathname = '/settings/general'
  })

  it('derives the settings tab from a route tab segment', async () => {
    routeMocks.pathname = '/settings/extensions'
    render(<SettingsRouteSurface tab="general" />)
    expect(await screen.findByText('Settings tab: extensions')).toBeInTheDocument()
  })

  it('falls back to the route-provided tab for unknown paths', async () => {
    routeMocks.pathname = '/settings/unknown'
    render(<SettingsRouteSurface tab="waggle" />)
    expect(await screen.findByText('Settings tab: waggle')).toBeInTheDocument()
  })

  it('recognizes Skills and Agents as settings tabs', async () => {
    routeMocks.pathname = '/settings/skills'
    const view = render(<SettingsRouteSurface tab="general" />)
    expect(await screen.findByText('Settings tab: skills')).toBeInTheDocument()
    view.unmount()
    routeMocks.pathname = '/settings/agents'
    render(<SettingsRouteSurface tab="general" />)
    expect(await screen.findByText('Settings tab: agents')).toBeInTheDocument()
  })
})
