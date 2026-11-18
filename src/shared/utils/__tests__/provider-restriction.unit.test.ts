import { describe, expect, it } from 'vitest'
import { providerScopePathRejection, resolveProviderRestriction } from '../provider-restriction'

describe('Provider restriction', () => {
  it('refuses a provider the app-wide scope disabled', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/personal/repo',
      appWide: { 'amazon-bedrock': false },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(false)
    expect(restriction.allows('openrouter')).toBe(true)
  })

  it('allows every provider when no scope mentions any', () => {
    const restriction = resolveProviderRestriction({ projectPath: '/projects/personal/repo' })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
    expect(restriction.allows('openrouter')).toBe(true)
  })

  it('refuses a provider a containing folder scope withdrew, leaving the rest open', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/personal/repo',
      byPath: { '/projects/personal': { openrouter: false } },
    })

    expect(restriction.allows('openrouter')).toBe(false)
    expect(restriction.allows('anthropic')).toBe(true)
  })

  it('closes a scope to exactly the providers its only list names', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/TC-mapping',
      byPath: { '/projects/DTD': { only: ['amazon-bedrock'] } },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
    expect(restriction.allows('openrouter')).toBe(false)
    expect(restriction.allows('anthropic')).toBe(false)
  })

  it('lets an only scope refuse a provider an outer scope allows', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/TC-mapping',
      byPath: { '/projects/DTD': { only: ['amazon-bedrock'] } },
      appWide: { openrouter: true },
    })

    expect(restriction.allows('openrouter')).toBe(false)
  })

  it('lets the nearest containing scope decide a provider', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/TC-mapping',
      byPath: {
        '/projects': { 'amazon-bedrock': false },
        '/projects/DTD': { 'amazon-bedrock': true },
      },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
  })

  it('ignores a scope that does not contain the project', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/personal/repo',
      byPath: { '/projects/DTD': { only: ['amazon-bedrock'] } },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
    expect(restriction.allows('anthropic')).toBe(true)
  })

  it('lets the project file outrank the path map', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/TC-mapping',
      byPath: { '/projects/DTD/TC-mapping': { 'amazon-bedrock': false } },
      projectOverride: { 'amazon-bedrock': true },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
  })

  it('lets a deeper grant add a provider an only scope refuses, without reopening the rest', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/TC-mapping',
      byPath: {
        '/projects/DTD': { only: ['amazon-bedrock'] },
        '/projects/DTD/TC-mapping': { openrouter: true },
      },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
    expect(restriction.allows('openrouter')).toBe(true)
    expect(restriction.allows('anthropic')).toBe(false)
  })

  it('matches a scope recorded under a project path alias', () => {
    const restriction = resolveProviderRestriction({
      projectPath: '/projects/DTD/renamed-repo',
      byPath: { '/projects/DTD/old-repo': { 'amazon-bedrock': true } },
      aliases: { '/projects/DTD/old-repo': '/projects/DTD/renamed-repo' },
    })

    expect(restriction.allows('amazon-bedrock')).toBe(true)
  })
})

describe('provider scope path guardrails', () => {
  const home = '/Users/dev'

  it('accepts a folder inside the home directory', () => {
    expect(providerScopePathRejection('/Users/dev/projects', home)).toBeNull()
  })

  it('refuses the home directory itself, anything above it, and paths outside it', () => {
    expect(providerScopePathRejection(home, home)).toContain('app-wide restriction')
    expect(providerScopePathRejection('/', home)).toContain('app-wide restriction')
    expect(providerScopePathRejection('/Users/other/projects', home)).toContain('app-wide')
  })

  it('refuses OpenWaggle own configuration folders', () => {
    expect(providerScopePathRejection(`${home}/.openwaggle`, home)).toContain("OpenWaggle's own")
    expect(providerScopePathRejection(`${home}/.openwaggle/worktrees/x`, home)).toContain(
      "OpenWaggle's own",
    )
  })
})
