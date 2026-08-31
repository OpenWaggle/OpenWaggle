import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('quick installer CLI layout', () => {
  it('writes managed shims on macOS and Linux', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')

    expect(source).not.toContain('ln -sf "${APP_EXECUTABLE}" "${INSTALL_DIR}/openwaggle"')
    expect(source.match(/Managed by OpenWaggle/g)).toHaveLength(2)
    expect(source).toContain("printf 'exec '\\''%s'\\'' \"$@\"\\n' \"${ESCAPED_APP_EXECUTABLE}\"")
    expect(source).toContain('OPENWAGGLE_CLI_OUTPUT_FD=3')
    expect(source).toContain('install_executable_atomically "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"')
    expect(source).not.toContain('cp "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"')
    expect(source.match(/mv -f "\$\{SHIM_TEMP_PATH\}" "\$\{INSTALL_PATH\}"/g)).toHaveLength(2)
  })

  it('preserves an open old inode while an installed executable path is atomically replaced', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-atomic-'))
    const installed = path.join(root, 'OpenWaggle.AppImage')
    const replacement = path.join(root, '.openwaggle-install.replacement')
    try {
      await fs.writeFile(installed, 'old-app-image')
      const oldHandle = await fs.open(installed, 'r')
      try {
        await fs.writeFile(replacement, 'new-app-image')
        await fs.rename(replacement, installed)
        const oldBuffer = Buffer.alloc('old-app-image'.length)
        await oldHandle.read(oldBuffer, 0, oldBuffer.length, 0)

        expect(oldBuffer.toString()).toBe('old-app-image')
        await expect(fs.readFile(installed, 'utf8')).resolves.toBe('new-app-image')
      } finally {
        await oldHandle.close()
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
