import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const DESKTOP_ENTRY_START = '# BEGIN TESTABLE LINUX DESKTOP ENTRY'
const DESKTOP_ENTRY_END = '# END TESTABLE LINUX DESKTOP ENTRY'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

/** A fake command that records its arguments, so the test sees exactly what the installer ran. */
async function recordingCommand(bin: string, name: string, log: string) {
  const command = path.join(bin, name)
  await fs.writeFile(command, `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${log}"\n`)
  await fs.chmod(command, 0o755)
}

/** Resolve a system utility so the test PATH can hold only it and the fakes, never real xdg-utils. */
async function systemCommand(name: string) {
  const { stdout } = await execFileAsync('sh', ['-c', `command -v ${name}`])
  return stdout.trim()
}

async function writeDesktopEntry(options: { readonly xdgUtils: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-desktop-entry-'))
  roots.push(root)
  const bin = path.join(root, 'bin')
  const log = path.join(root, 'calls.log')
  await fs.mkdir(bin)
  for (const utility of ['mkdir', 'cat']) {
    await fs.symlink(await systemCommand(utility), path.join(bin, utility))
  }
  if (options.xdgUtils) {
    await recordingCommand(bin, 'xdg-mime', log)
    await recordingCommand(bin, 'update-desktop-database', log)
  }
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const start = source.indexOf(DESKTOP_ENTRY_START)
  const end = source.indexOf(DESKTOP_ENTRY_END)
  if (start < 0 || end <= start) throw new Error('Installer desktop entry block was not found.')
  const desktopDir = path.join(root, 'applications')
  const script = `set -euo pipefail
${source.slice(start + DESKTOP_ENTRY_START.length, end)}
write_linux_desktop_entry "$1" "$2"`
  const bash = await systemCommand('bash')
  await execFileAsync(bash, ['-c', script, 'desktop-entry-test', desktopDir, '/opt/OpenWaggle.AppImage'], {
    // Only the fake commands and the utilities the block needs, so a real xdg-mime never runs.
    env: { PATH: bin },
  })
  const entry = await fs.readFile(path.join(desktopDir, 'openwaggle.desktop'), 'utf8')
  const calls = await fs.readFile(log, 'utf8').catch(() => '')
  return { entry, calls: calls.trim().split('\n').filter(Boolean), desktopDir }
}

describe('quick installer Linux desktop entry', () => {
  it('declares and registers the Session link scheme', async () => {
    const { entry, calls, desktopDir } = await writeDesktopEntry({ xdgUtils: true })

    expect(entry).toContain('Exec=/opt/OpenWaggle.AppImage %U\n')
    expect(entry).toContain('MimeType=x-scheme-handler/openwaggle;\n')
    expect(calls).toEqual([
      `update-desktop-database ${desktopDir}`,
      'xdg-mime default openwaggle.desktop x-scheme-handler/openwaggle',
    ])
  })

  it('still writes the entry on a desktop without xdg-utils', async () => {
    const { entry, calls } = await writeDesktopEntry({ xdgUtils: false })

    expect(entry).toContain('MimeType=x-scheme-handler/openwaggle;\n')
    expect(calls).toEqual([])
  })
})
