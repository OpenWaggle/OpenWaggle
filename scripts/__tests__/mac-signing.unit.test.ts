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

  it('leaves builds unsigned without a certificate, whatever the channel', () => {
    expect(resolveMacSigning('beta', {})).toEqual({ identity: null })
    expect(resolveMacSigning('stable', {})).toEqual({ identity: null })
    expect(resolveMacSigning('rc', {})).toEqual({ identity: null })
  })

  it('signs and notarizes release builds when credentials are configured', () => {
    expect(resolveMacSigning('stable', { ...certificate, ...notarization })).toEqual({
      hardenedRuntime: true,
      notarize: true,
    })
    expect(resolveMacSigning('beta', certificate)).toEqual({ hardenedRuntime: true, notarize: false })
  })
})
