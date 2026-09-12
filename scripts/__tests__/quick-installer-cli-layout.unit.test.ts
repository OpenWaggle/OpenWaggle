import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const GUARD_START = '# BEGIN TESTABLE CLI TARGET GUARD'
const GUARD_END = '# END TESTABLE CLI TARGET GUARD'

function cliTargetGuard(source: string) {
  const start = source.indexOf(GUARD_START)
  const end = source.indexOf(GUARD_END)
  if (start < 0 || end <= start) throw new Error('Quick installer CLI target guard was not found.')
  return source.slice(start + GUARD_START.length, end)
}

async function installShim(input: {
  readonly source: string
  readonly replacement: string
  readonly target: string
  readonly platform: 'mac' | 'linux'
  readonly legacyReference: string
  readonly swapBeforeBackup?: boolean
  readonly failBackupMove?: boolean
}) {
  const moveOverride = input.swapBeforeBackup
    ? `RACE_TARGET="$2"
mv() {
  if [ "$1" = "\${RACE_TARGET}" ]; then
    rm -f "\${RACE_TARGET}"
    printf '%s' 'foreign race replacement' > "\${RACE_TARGET}"
  fi
  command mv "$@"
}
`
    : input.failBackupMove
      ? `RACE_TARGET="$2"
mv() {
  if [ "$1" = "\${RACE_TARGET}" ]; then
    return 1
  fi
  command mv "$@"
}
`
    : ''
  const script = `${cliTargetGuard(input.source)}\n${moveOverride}install_cli_shim_atomically "$1" "$2" "$3" "$4"`
  return execFileAsync('bash', [
    '-c',
    script,
    'quick-installer-test',
    input.replacement,
    input.target,
    input.platform,
    input.legacyReference,
  ])
}

describe('quick installer CLI layout', () => {
  it('writes managed shims on macOS and Linux', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')

    expect(source).not.toContain('ln -sf "${APP_EXECUTABLE}" "${INSTALL_DIR}/openwaggle"')
    expect(source.match(/Managed by OpenWaggle/g)).toHaveLength(1)
    expect(source.match(/printf '%s\\n' "\$\{CLI_SHIM_MARKER\}"/g)).toHaveLength(2)
    expect(source).toContain('bs=512 count=1')
    expect(source).toContain("printf 'exec '\\''%s'\\'' \"$@\"\\n' \"${ESCAPED_APP_EXECUTABLE}\"")
    expect(source).toContain('OPENWAGGLE_CLI_OUTPUT_FD=3')
    expect(source).toContain('install_executable_atomically "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"')
    expect(source).not.toContain('cp "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"')
    expect(source.match(/install_cli_shim_atomically "\$\{SHIM_TEMP_PATH\}"/g)).toHaveLength(2)
    expect(source).toContain('APPLICATIONS_DIR="${OPENWAGGLE_APPLICATIONS_DIR:-/Applications}"')
    expect(source).toContain('APP_EXECUTABLE="${APPLICATIONS_DIR}/$(basename "${APP_PATH}")')
  })

  it.each(['file', 'symlink', 'directory'] as const)(
    'preserves an unrelated command %s and fails safely',
    async (kind) => {
      const source = await fs.readFile('scripts/install.sh', 'utf8')
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-guard-'))
      const target = path.join(root, 'openwaggle')
      const replacement = path.join(root, 'replacement')
      const unrelatedTarget = path.join(root, 'unrelated')
      try {
        await fs.writeFile(replacement, '#!/bin/sh\n# replacement\n')
        if (kind === 'file') await fs.writeFile(target, '#!/bin/sh\necho unrelated\n')
        if (kind === 'symlink') {
          await fs.writeFile(unrelatedTarget, 'unrelated executable')
          await fs.symlink(unrelatedTarget, target)
        }
        if (kind === 'directory') await fs.mkdir(target)

        await expect(
          installShim({
            source,
            replacement,
            target,
            platform: 'mac',
            legacyReference: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
          }),
        ).rejects.toMatchObject({ code: 1 })

        const targetStats = await fs.lstat(target)
        if (kind === 'file') await expect(fs.readFile(target, 'utf8')).resolves.toContain('unrelated')
        if (kind === 'symlink') {
          expect(targetStats.isSymbolicLink()).toBe(true)
          await expect(fs.readlink(target)).resolves.toBe(unrelatedTarget)
        }
        if (kind === 'directory') expect(targetStats.isDirectory()).toBe(true)
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  )

  it('revalidates the displaced target and restores a file swapped in after admission', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-race-'))
    const target = path.join(root, 'openwaggle')
    const replacement = path.join(root, 'replacement')
    try {
      await fs.writeFile(
        target,
        '#!/bin/sh\n# Managed by OpenWaggle. Configure from Settings > Agent access.\n',
      )
      await fs.writeFile(replacement, 'new managed shim')

      await expect(
        installShim({
          source,
          replacement,
          target,
          platform: 'mac',
          legacyReference: '',
          swapBeforeBackup: true,
        }),
      ).rejects.toMatchObject({ code: 1 })

      await expect(fs.readFile(target, 'utf8')).resolves.toBe('foreign race replacement')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('cleans its empty backup directory when target displacement fails', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-move-failure-'))
    const target = path.join(root, 'openwaggle')
    const replacement = path.join(root, 'replacement')
    try {
      const managed =
        '#!/bin/sh\n# Managed by OpenWaggle. Configure from Settings > Agent access.\n'
      await fs.writeFile(target, managed)
      await fs.writeFile(replacement, 'new managed shim')

      await expect(
        installShim({
          source,
          replacement,
          target,
          platform: 'mac',
          legacyReference: '',
          failBackupMove: true,
        }),
      ).rejects.toMatchObject({ code: 1 })

      await expect(fs.readFile(target, 'utf8')).resolves.toBe(managed)
      await expect(fs.readdir(root)).resolves.toEqual(['openwaggle'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('replaces managed shims and recognized legacy layouts', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installer-owned-'))
    const target = path.join(root, 'openwaggle')
    const replacement = path.join(root, 'replacement')
    const legacyExecutable = '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle'
    try {
      await fs.writeFile(target, '#!/bin/sh\n# Managed by OpenWaggle. Configure from Settings > Agent access.\n')
      await fs.writeFile(replacement, 'managed replacement')
      await expect(
        installShim({ source, replacement, target, platform: 'mac', legacyReference: '' }),
      ).resolves.toBeDefined()
      await expect(fs.readFile(target, 'utf8')).resolves.toBe('managed replacement')

      await fs.rm(target)
      await fs.symlink(legacyExecutable, target)
      await fs.writeFile(replacement, 'mac legacy replacement')
      await expect(
        installShim({
          source,
          replacement,
          target,
          platform: 'mac',
          legacyReference: legacyExecutable,
        }),
      ).resolves.toBeDefined()
      await expect(fs.readFile(target, 'utf8')).resolves.toBe('mac legacy replacement')

      const desktop = path.join(root, 'openwaggle.desktop')
      await fs.writeFile(target, 'plain executable', { mode: 0o700 })
      await fs.chmod(target, 0o700)
      await fs.writeFile(desktop, `[Desktop Entry]\nName=OpenWaggle\nExec=${target} %U\n`)
      await fs.writeFile(replacement, 'linux legacy replacement')
      await expect(
        installShim({ source, replacement, target, platform: 'linux', legacyReference: desktop }),
      ).rejects.toMatchObject({ code: 1 })
      await expect(fs.readFile(target, 'utf8')).resolves.toBe('plain executable')

      const appImageHeader = Buffer.alloc(11)
      appImageHeader.set([0x7f, 0x45, 0x4c, 0x46], 0)
      appImageHeader.set([0x41, 0x49, 0x02], 8)
      await fs.writeFile(target, appImageHeader, { mode: 0o700 })
      await fs.writeFile(replacement, 'linux legacy replacement')
      await expect(
        installShim({ source, replacement, target, platform: 'linux', legacyReference: desktop }),
      ).resolves.toBeDefined()
      await expect(fs.readFile(target, 'utf8')).resolves.toBe('linux legacy replacement')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
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
