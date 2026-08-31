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
})
