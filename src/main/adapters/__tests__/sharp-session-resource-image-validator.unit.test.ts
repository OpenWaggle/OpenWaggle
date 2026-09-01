import { describe, expect, it } from 'vitest'
import { PNG_BASE64 } from '../../application/__tests__/session-resource-capture.fixtures'
import { decodeSessionResourceImage } from '../sharp-session-resource-image-validator'

describe('decodeSessionResourceImage', () => {
  it('accepts an image only after the complete payload decodes', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64')

    await expect(decodeSessionResourceImage(bytes, 'image/png')).resolves.toMatchObject({
      mimeType: 'image/png',
    })
  })

  it('rejects a truncated payload even when its signature and dimensions are valid', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64')

    await expect(
      decodeSessionResourceImage(bytes.subarray(0, bytes.byteLength - 30), 'image/png'),
    ).resolves.toBeNull()
  })
})
