import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SyntaxResourceCatalog } from '@shared/types/syntax-resources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readProjectSyntaxCatalog,
  type SyntaxSourceParser,
} from '../syntax-resource-project-catalog'

const EMPTY_CATALOG = {
  themes: [],
  languages: [],
  appearances: [],
} satisfies SyntaxResourceCatalog

describe('project syntax catalog root discovery', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-syntax-discovery-'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('treats absent optional resource roots as an empty catalog', async () => {
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).resolves.toEqual(EMPTY_CATALOG)
    expect(parseSource).not.toHaveBeenCalled()
  })

  it('propagates operational failures while reading a resource root', async () => {
    const themesRoot = path.join(projectPath, '.openwaggle', 'themes')
    await fs.mkdir(path.dirname(themesRoot), { recursive: true })
    await fs.writeFile(themesRoot, 'not a directory')
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
    expect(parseSource).not.toHaveBeenCalled()
  })
})
