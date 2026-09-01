import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vscodeLanguageAssociation } from '../workspace-language-detection'

const REPEATED_BRACE_GROUPS = 25

describe('workspace language detection', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-language-detection-'))
    await fs.mkdir(path.join(projectPath, '.vscode'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('bounds brace expansion and continues to later associations', async () => {
    const exponentialPattern = `${'{a,b}'.repeat(REPEATED_BRACE_GROUPS)}.never`
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          [exponentialPattern]: 'plaintext',
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })
})
