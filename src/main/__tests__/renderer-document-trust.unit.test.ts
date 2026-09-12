import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  env: { ELECTRON_RENDERER_URL: '' },
}))

vi.mock('../env', () => ({ env: runtime.env }))

import { isTrustedRendererDocument } from '../renderer-document-trust'

describe('trusted renderer documents', () => {
  beforeEach(() => {
    runtime.env.ELECTRON_RENDERER_URL = ''
  })

  it('accepts only the packaged OpenWaggle application host', () => {
    expect(isTrustedRendererDocument('openwaggle://app/')).toBe(true)
    expect(isTrustedRendererDocument('openwaggle://app/sessions/one')).toBe(true)
    expect(isTrustedRendererDocument('openwaggle://attacker/')).toBe(false)
    expect(isTrustedRendererDocument('file:///etc/passwd')).toBe(false)
  })

  it('matches the complete development origin instead of a string prefix', () => {
    runtime.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    expect(isTrustedRendererDocument('http://localhost:5173/?reload=1')).toBe(true)
    expect(isTrustedRendererDocument('http://localhost:51730/')).toBe(false)
    expect(isTrustedRendererDocument('http://localhost:5173.attacker.invalid/')).toBe(false)
  })
})
