import { describe, expect, it } from 'vitest'
import { backends, parsePtyProbeProfile } from '../native-pty-probe-support'

describe('native PTY probe profiles', () => {
  it('defaults to runtime selection and accepts only explicit known profiles', () => {
    expect(parsePtyProbeProfile(undefined)).toBe('runtime')
    expect(parsePtyProbeProfile('runtime')).toBe('runtime')
    expect(parsePtyProbeProfile('all-backends')).toBe('all-backends')
    expect(() => parsePtyProbeProfile('skip')).toThrow('Unknown PTY probe profile')
    expect(() => parsePtyProbeProfile('')).toThrow('Unknown PTY probe profile')
  })

  it.each(['darwin', 'linux'] as const)('keeps Unix checks identical for %s', (platform) => {
    expect(backends(platform)).toEqual([{ label: 'Unix PTY', options: {} }])
    expect(backends(platform, 'all-backends')).toEqual(backends(platform))
  })

  it('retains every forced Windows backend in the diagnostic profile', () => {
    expect(backends('win32', 'all-backends')).toEqual([
      { label: 'system ConPTY', options: { useConpty: true, useConptyDll: false } },
      { label: 'bundled ConPTY', options: { useConpty: true, useConptyDll: true } },
      { label: 'WinPTY', options: { useConpty: false } },
    ])
  })
})
