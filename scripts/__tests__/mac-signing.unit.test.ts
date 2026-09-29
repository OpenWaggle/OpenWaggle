import { describe, expect, it } from 'vitest'
import { resolveMacSigning } from '../mac-signing'

const certificate = { CSC_LINK: 'base64-p12', CSC_KEY_PASSWORD: 'secret' }
const notarization = {
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
  APPLE_TEAM_ID: 'TEAM123456',
}

describe('macOS signing', () => {
  it('keeps dev builds unsigned even when a certificate is present', () => {
    expect(resolveMacSigning('dev', { ...certificate, ...notarization })).toEqual({ identity: null })
  })

  it('lets prerelease builds ship unsigned until a certificate is configured', () => {
    expect(resolveMacSigning('beta', {})).toEqual({ identity: null })
    expect(resolveMacSigning('alpha', {})).toEqual({ identity: null })
  })

  it('signs and notarizes release builds when credentials are configured', () => {
    expect(resolveMacSigning('beta', { ...certificate, ...notarization })).toEqual({
      hardenedRuntime: true,
      notarize: true,
    })
    expect(resolveMacSigning('beta', certificate)).toEqual({ hardenedRuntime: true, notarize: false })
  })

  it('fails closed for release candidates and Stable without signing and notarization', () => {
    expect(() => resolveMacSigning('rc', {}, 'darwin')).toThrow(/Release candidate macOS builds must be signed/u)
    expect(() => resolveMacSigning('stable', certificate, 'darwin')).toThrow(/Stable macOS builds must be signed/u)
    expect(resolveMacSigning('stable', { ...certificate, ...notarization }, 'darwin')).toEqual({
      hardenedRuntime: true,
      notarize: true,
    })
  })

  it('does not block Linux and Windows release jobs that load the same configuration', () => {
    expect(resolveMacSigning('stable', {}, 'linux')).toEqual({ identity: null })
    expect(resolveMacSigning('rc', {}, 'win32')).toEqual({ identity: null })
  })
})
