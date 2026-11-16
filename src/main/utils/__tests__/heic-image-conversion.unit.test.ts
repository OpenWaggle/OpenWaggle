import { randomFillSync } from 'node:crypto'
import { PI_PROMPT_IMAGE_DEFAULTS } from '@shared/constants/prompt-image'
import { describe, expect, it } from 'vitest'
import {
  base64ByteLength,
  convertHeicToAttachmentImage,
  encodePromptImage,
  isHeicImageMimeType,
} from '../heic-image-conversion'

/** A real 8x8 HEIC, the smallest file the format allows. */
const HEIC_8X8_BASE64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAA' +
  'AAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAA' +
  'AQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAA' +
  'FGlzcGUAAAAAAAAACAAAAAgAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAAL' +
  'A6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAmw7iHuRZVNwICBgCogAB' +
  'AAlEAcBhcshEU2QAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAAA/AAAAAW1k' +
  'YXQAAAAAAAAATwAAADsoAa+i+kaBfP/92s//9uX7L9AKPVf/tCfI+buy/6ZQ90yyZ/og+cI53hzw5nPv9uVCL2FfgrcISbIr' +
  'gA=='

function heicFixture() {
  return new Uint8Array(Buffer.from(HEIC_8X8_BASE64, 'base64'))
}

/** Pixels a JPEG cannot compress away, so the encoder has to shrink to fit. */
function noisyPhoto(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  randomFillSync(data)
  return { data, width, height }
}

describe('isHeicImageMimeType', () => {
  it.each(['image/heic', 'image/heif', 'image/heic-sequence', 'IMAGE/HEIC; codecs=hevc'])(
    'recognizes %s',
    (mimeType) => {
      expect(isHeicImageMimeType(mimeType)).toBe(true)
    },
  )

  it.each(['image/png', 'image/jpeg', 'image/webp', 'text/plain'])(
    'leaves %s alone',
    (mimeType) => {
      expect(isHeicImageMimeType(mimeType)).toBe(false)
    },
  )
})

describe('convertHeicToAttachmentImage', () => {
  it('decodes a HEIC into a JPEG named after the file it came from', async () => {
    const converted = await convertHeicToAttachmentImage({
      bytes: heicFixture(),
      fileName: 'IMG_4521.HEIC',
    })

    expect(converted.mimeType).toBe('image/jpeg')
    expect(converted.fileName).toBe('IMG_4521.jpg')
    expect(Array.from(converted.bytes.subarray(0, 2))).toEqual([0xff, 0xd8])
    expect(converted.bytes.byteLength).toBeGreaterThan(0)
  })

  it('refuses bytes that are not a HEIC image', async () => {
    await expect(
      convertHeicToAttachmentImage({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        fileName: 'not-heic.heic',
      }),
    ).rejects.toThrow()
  })
})

describe('encodePromptImage', () => {
  it('fits a phone-sized photo inside Pi\u2019s inline image budget', async () => {
    const encoded = await encodePromptImage(noisyPhoto(4032, 3024))

    expect(base64ByteLength(encoded.byteLength)).toBeLessThan(
      PI_PROMPT_IMAGE_DEFAULTS.MAX_BASE64_BYTES,
    )
    expect(encoded.byteLength).toBeLessThan(PI_PROMPT_IMAGE_DEFAULTS.MAX_DIMENSION * 1024)
  })

  it('leaves an image smaller than the budget at its own size', async () => {
    const encoded = await encodePromptImage(noisyPhoto(64, 48))

    expect(base64ByteLength(encoded.byteLength)).toBeLessThan(
      PI_PROMPT_IMAGE_DEFAULTS.MAX_BASE64_BYTES,
    )
    expect(Array.from(encoded.subarray(0, 2))).toEqual([0xff, 0xd8])
  })
})
