import type { VcsStatus } from '@shared/types/git'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  changeRequestProviderFromUrl,
  effectiveChangeRequestAttention,
  formatAlternatives,
  providerSiteLabel,
  sourceControlCliInstallCommand,
} from '../change-request-attention'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)'

describe('effectiveChangeRequestAttention', () => {
  it('prefers the remote CLI or account attention', () => {
    const status = fromPartial<VcsStatus>({
      sourceControlProvider: { id: 'github', host: 'github.com' },
      sourceControlAttention: null,
      changeRequestAttention: {
        kind: 'cli-missing',
        provider: 'github',
        host: 'github.com',
        cli: 'gh',
      },
    })
    expect(effectiveChangeRequestAttention(status)?.kind).toBe('cli-missing')
  })

  it('drops an offline provider question once the remote probe decided the provider', () => {
    const status = fromPartial<VcsStatus>({
      sourceControlProvider: { id: 'gitlab', host: 'git.corp.example' },
      sourceControlAttention: { kind: 'choose-provider', host: 'git.corp.example' },
      changeRequestAttention: null,
    })
    expect(effectiveChangeRequestAttention(status)).toBeNull()
  })

  it('keeps an offline declaration approval', () => {
    const status = fromPartial<VcsStatus>({
      sourceControlProvider: { id: 'gitlab', host: 'git.corp.example' },
      sourceControlAttention: {
        kind: 'approve-declaration',
        projectPath: '/repo',
        hosts: { 'git.corp.example': 'gitlab' },
      },
      changeRequestAttention: null,
    })
    expect(effectiveChangeRequestAttention(status)?.kind).toBe('approve-declaration')
  })
})

describe('changeRequestProviderFromUrl', () => {
  it.each([
    ['https://github.com/o/r/pull/7', 'github'],
    ['https://git.corp.example/group/sub/r/-/merge_requests/3', 'gitlab'],
    ['https://gitlab.example/o/r', 'gitlab'],
    ['https://example.com/o/r', null],
    ['not a url', null],
  ] as const)('reads %s as %s', (url, provider) => {
    expect(changeRequestProviderFromUrl(url)).toBe(provider)
  })
})

describe('sourceControlCliInstallCommand', () => {
  it('uses Homebrew on macOS and winget on Windows', () => {
    expect(sourceControlCliInstallCommand('gh', MAC)).toBe('brew install gh')
    expect(sourceControlCliInstallCommand('glab', MAC)).toBe('brew install glab')
    expect(sourceControlCliInstallCommand('gh', WINDOWS)).toBe('winget install --id GitHub.cli')
    expect(sourceControlCliInstallCommand('glab', WINDOWS)).toBe('winget install --id GLab.GLab')
  })

  it('leaves Linux to the install guide', () => {
    expect(sourceControlCliInstallCommand('gh', LINUX)).toBeNull()
  })
})

describe('providerSiteLabel', () => {
  it('names the provider, or the host when the provider is unknown', () => {
    expect(providerSiteLabel('github', 'https://ghe.corp.example/o/r')).toBe('Open on GitHub')
    expect(providerSiteLabel(null, 'https://gitlab.com/o/r')).toBe('Open on GitLab')
    expect(providerSiteLabel(null, 'https://code.corp.example/o/r')).toBe(
      'Open on code.corp.example',
    )
  })
})

describe('formatAlternatives', () => {
  it('joins names for a sentence', () => {
    expect(formatAlternatives(['A'])).toBe('A')
    expect(formatAlternatives(['A', 'B'])).toBe('A or B')
    expect(formatAlternatives(['A', 'B', 'C'])).toBe('A, B or C')
  })
})
