import { describe, expect, it } from 'vitest'
import { staleCertificateTable } from '../electrobun/sign-windows'

const PE_OFFSET = 0x40
const OPTIONAL_HEADER_SIZE = 0xf0
const SECTION_START = 0x200
const SECTION_SIZE = 0x200
const CERTIFICATE_SIZE = 8
const CERTIFICATE_ENTRY = PE_OFFSET + 24 + 112 + 4 * 8

/** A PE32+ image with one section of raw data at 0x200..0x400 and a certificate table entry. */
function peImage(certificateOffset: number, length: number) {
  const image = Buffer.alloc(length)
  image.writeUInt32LE(PE_OFFSET, 0x3c)
  image.writeUInt32LE(0x00004550, PE_OFFSET)
  image.writeUInt16LE(1, PE_OFFSET + 6)
  image.writeUInt16LE(OPTIONAL_HEADER_SIZE, PE_OFFSET + 20)
  image.writeUInt16LE(0x20b, PE_OFFSET + 24)
  image.writeUInt32LE(certificateOffset, CERTIFICATE_ENTRY)
  image.writeUInt32LE(certificateOffset === 0 ? 0 : CERTIFICATE_SIZE, CERTIFICATE_ENTRY + 4)
  const section = PE_OFFSET + 24 + OPTIONAL_HEADER_SIZE
  image.writeUInt32LE(SECTION_SIZE, section + 16)
  image.writeUInt32LE(SECTION_START, section + 20)
  return image
}

const END_OF_SECTIONS = SECTION_START + SECTION_SIZE

describe('staleCertificateTable', () => {
  it('keeps an unsigned image and a signature after every section', () => {
    expect(staleCertificateTable(peImage(0, END_OF_SECTIONS))).toBeNull()
    expect(
      staleCertificateTable(peImage(END_OF_SECTIONS, END_OF_SECTIONS + CERTIFICATE_SIZE)),
    ).toBeNull()
  })

  it('finds a signature that a resource edit left inside the sections or past the end', () => {
    // A resource editor grew the sections over the old table, as Hutch does to Bun's bun.exe.
    expect(staleCertificateTable(peImage(END_OF_SECTIONS - 0x100, END_OF_SECTIONS))).toBe(
      CERTIFICATE_ENTRY,
    )
    expect(staleCertificateTable(peImage(END_OF_SECTIONS, END_OF_SECTIONS))).toBe(CERTIFICATE_ENTRY)
  })

  it('ignores files that are not PE images', () => {
    expect(staleCertificateTable(Buffer.alloc(END_OF_SECTIONS))).toBeNull()
    expect(staleCertificateTable(Buffer.from('MZ'))).toBeNull()
  })
})
