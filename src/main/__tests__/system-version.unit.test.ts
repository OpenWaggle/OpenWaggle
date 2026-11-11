import { release } from 'node:os'
import { describe, expect, it } from 'vitest'
import { systemVersion } from '../system-version'

const PLIST = `<?xml version="1.0"?><plist><dict>
<key>ProductName</key><string>macOS</string>
<key>ProductVersion</key>
<string>26.1</string>
</dict></plist>`

describe('systemVersion', () => {
  it('reads the macOS product version, not the Darwin release', () => {
    expect(systemVersion('darwin', () => PLIST)).toBe('26.1')
  })

  it('falls back to the kernel release when the plist cannot be read', () => {
    expect(
      systemVersion('darwin', () => {
        throw new Error('missing')
      }),
    ).toBe(release())
  })

  it('uses the kernel release on Windows and Linux', () => {
    expect(systemVersion('win32')).toBe(release())
    expect(systemVersion('linux')).toBe(release())
  })
})
