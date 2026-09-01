import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSyntaxThemeSource } from '../syntax-theme-import'

describe('VS Code syntax extension import limits', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-vscode-syntax-limit-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(['themes', 'grammars'] as const)(
    'rejects too many unpacked %s before reading resource files',
    async (kind) => {
      await fs.writeFile(
        path.join(temporaryRoot, 'package.json'),
        JSON.stringify({
          publisher: 'acme',
          name: `oversized-${kind}`,
          contributes: {
            [kind]: Array.from({ length: 21 }, (_, index) => ({
              path: `./missing-${String(index)}.json`,
            })),
          },
        }),
      )

      await expect(parseSyntaxThemeSource(temporaryRoot, 'user')).rejects.toThrow(
        'declares too many resources',
      )
    },
  )

  it.skipIf(process.platform === 'win32')('rejects a symlinked extension manifest', async () => {
    const manifestTarget = path.join(temporaryRoot, 'manifest-target.json')
    await fs.writeFile(
      manifestTarget,
      JSON.stringify({
        publisher: 'acme',
        name: 'symlinked-manifest',
        contributes: { themes: [{ path: './theme.json' }] },
      }),
    )
    await fs.symlink(manifestTarget, path.join(temporaryRoot, 'package.json'))

    await expect(parseSyntaxThemeSource(temporaryRoot, 'user')).rejects.toThrow(
      'must not be a symbolic link',
    )
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO extension manifest without waiting for a writer',
    async () => {
      const manifestPath = path.join(temporaryRoot, 'package.json')
      const result = spawnSync('mkfifo', [manifestPath])
      expect(result.status).toBe(0)

      await expect(parseSyntaxThemeSource(temporaryRoot, 'user')).rejects.toThrow('must be a file')
    },
    1_000,
  )
})
