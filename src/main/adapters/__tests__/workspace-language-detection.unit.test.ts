import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vscodeLanguageAssociation } from '../workspace-language-detection'

const REPEATED_BRACE_GROUPS = 25
const ASSOCIATION_STRESS_COUNT = 4_000

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

  it('shares the brace expansion budget across the complete association scan', async () => {
    const expensiveAssociations = Object.fromEntries(
      Array.from({ length: ASSOCIATION_STRESS_COUNT }, (_, index) => [
        `${'{a,b}'.repeat(REPEATED_BRACE_GROUPS)}-${String(index)}.never`,
        'plaintext',
      ]),
    )
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          ...expensiveAssociations,
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it.each(['file.test.js', 'file.test.ts'])(
    'preserves VS Code character-class associations for %s',
    async (filename) => {
      await fs.writeFile(
        path.join(projectPath, '.vscode', 'settings.json'),
        JSON.stringify({ 'files.associations': { '*.test.[jt]s': 'javascript' } }),
      )

      await expect(vscodeLanguageAssociation(projectPath, filename)).resolves.toBe('javascript')
    },
  )
})
