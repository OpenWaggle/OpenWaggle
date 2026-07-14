import { safeDecodeUnknown } from '@shared/schema'
import { extensionFrameRegisterInputSchema } from '@shared/schemas/extension-frame'
import { describe, expect, it } from 'vitest'

describe('extension frame schemas', () => {
  it('accepts exact HTTPS network origins for frame registration', () => {
    const result = safeDecodeUnknown(extensionFrameRegisterInputSchema, {
      frameId: 'frame-1',
      bootstrapUrl: 'openwaggle://app/assets/extension-frame-bootstrap.js',
      networkOrigins: ['https://api.github.com'],
    })

    expect(result.success).toBe(true)
  })

  it.each([
    'http://api.github.com',
    'https://api.github.com/repos',
    'data:text/plain,hi',
  ])('rejects non-exact HTTPS network origin %s', (networkOrigin) => {
    const result = safeDecodeUnknown(extensionFrameRegisterInputSchema, {
      frameId: 'frame-1',
      bootstrapUrl: 'openwaggle://app/assets/extension-frame-bootstrap.js',
      networkOrigins: [networkOrigin],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('networkOrigins.0')
    }
  })
})
