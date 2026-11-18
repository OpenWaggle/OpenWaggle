import { describe, expect, it } from 'vitest'
import { parseSafariBinaryCookies } from '../safari-cookie-reader'

const PAGE_BYTES = 256
const COOKIE_OFFSET = 32

function writeCString(buffer: Buffer, offset: number, value: string) {
  buffer.write(value, offset, 'utf8')
  buffer.writeUInt8(0, offset + Buffer.byteLength(value))
}

function safariCookieFixture() {
  const cookie = Buffer.alloc(160)
  const domainOffset = 56
  const nameOffset = 76
  const pathOffset = 92
  const valueOffset = 96
  cookie.writeUInt32LE(cookie.length, 0)
  cookie.writeUInt32LE(0x5, 8)
  cookie.writeUInt32LE(domainOffset, 16)
  cookie.writeUInt32LE(nameOffset, 20)
  cookie.writeUInt32LE(pathOffset, 24)
  cookie.writeUInt32LE(valueOffset, 28)
  cookie.writeDoubleLE(800_000_000, 40)
  writeCString(cookie, domainOffset, '.example.test')
  writeCString(cookie, nameOffset, 'session')
  writeCString(cookie, pathOffset, '/')
  writeCString(cookie, valueOffset, 'secret-value')

  const page = Buffer.alloc(PAGE_BYTES)
  page.writeUInt32LE(0x100, 0)
  page.writeUInt32LE(1, 4)
  page.writeUInt32LE(COOKIE_OFFSET, 8)
  cookie.copy(page, COOKIE_OFFSET)

  const file = Buffer.alloc(12 + PAGE_BYTES)
  file.write('cook', 0, 'ascii')
  file.writeUInt32BE(1, 4)
  file.writeUInt32BE(PAGE_BYTES, 8)
  page.copy(file, 12)
  return file
}

describe('Safari binary cookie reader', () => {
  it('preserves domain scope and security flags', () => {
    expect(parseSafariBinaryCookies(safariCookieFixture())).toEqual({
      cookies: [
        {
          url: 'https://example.test/',
          domain: '.example.test',
          name: 'session',
          value: 'secret-value',
          path: '/',
          secure: true,
          httpOnly: true,
          expirationDate: 1_778_307_200,
          sameSite: 'unspecified',
        },
      ],
      skipped: 0,
      skippedDomains: [],
    })
  })

  it('rejects truncated page tables and out-of-bounds cookie records', () => {
    const truncated = Buffer.from('cook\u0000\u0000\u0000\u0001')
    expect(() => parseSafariBinaryCookies(truncated)).toThrow('page table is truncated')
    const malformed = safariCookieFixture()
    malformed.writeUInt32BE(PAGE_BYTES + 1, 8)
    expect(() => parseSafariBinaryCookies(malformed)).toThrow('page is truncated')
  })
})
