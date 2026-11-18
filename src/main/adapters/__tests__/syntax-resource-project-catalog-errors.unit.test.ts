import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SyntaxResourceCatalog } from '@shared/types/syntax-resources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readProjectSyntaxCatalog,
  type SyntaxSourceParser,
} from '../syntax-resource-project-catalog'
import { SyntaxSourceValidationError } from '../syntax-source-errors'

const EMPTY_CATALOG = {
  themes: [],
  languages: [],
  appearances: [],
} satisfies SyntaxResourceCatalog

describe('project syntax parser errors', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-syntax-errors-'))
    await fs.mkdir(path.join(projectPath, '.openwaggle', 'themes'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('continues after a tagged malformed resource', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectPath, '.openwaggle', 'themes', 'malformed.json'), '{'),
      fs.writeFile(path.join(projectPath, '.openwaggle', 'themes', 'valid.json'), '{}'),
    ])
    let calls = 0
    const parseSource: SyntaxSourceParser = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new SyntaxSourceValidationError('Malformed syntax resource')
      return EMPTY_CATALOG
    })

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).resolves.toEqual(EMPTY_CATALOG)
    expect(parseSource).toHaveBeenCalledTimes(2)
  })

  it.each(['EACCES', 'EIO', 'ENOENT'])(
    'propagates parser filesystem errors with code %s',
    async (code) => {
      await fs.writeFile(path.join(projectPath, '.openwaggle', 'themes', 'resource.json'), '{}')
      const operationalError = new Error(`Filesystem operation failed with ${code}`)
      Object.defineProperty(operationalError, 'code', { value: code })
      const parseSource: SyntaxSourceParser = vi.fn(async () => {
        throw operationalError
      })

      await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toBe(
        operationalError,
      )
    },
  )
})
