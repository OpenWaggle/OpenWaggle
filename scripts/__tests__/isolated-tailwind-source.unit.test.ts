import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectTailwindSourceFiles } from '../vite/isolated-tailwind-source'

const temporaryRoots: string[] = []

function temporaryProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'openwaggle-tailwind-source-test-'))
  temporaryRoots.push(projectRoot)
  mkdirSync(join(projectRoot, 'src/renderer/src/components/__tests__'), { recursive: true })
  mkdirSync(join(projectRoot, 'packages/extension-react/src'), { recursive: true })
  mkdirSync(join(projectRoot, '.git/objects'), { recursive: true })
  return projectRoot
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('isolated Tailwind source collection', () => {
  it('collects runtime renderer sources without walking tests, Git metadata, or unrelated roots', () => {
    const projectRoot = temporaryProject()
    writeFileSync(join(projectRoot, 'src/renderer/src/App.tsx'), '<main className="flex" />')
    writeFileSync(join(projectRoot, 'src/renderer/src/components/helper.ts'), 'export const gap = 2')
    writeFileSync(
      join(projectRoot, 'src/renderer/src/components/__tests__/App.test.tsx'),
      '<main className="hidden" />',
    )
    writeFileSync(join(projectRoot, 'packages/extension-react/src/index.tsx'), '<div />')
    writeFileSync(join(projectRoot, '.git/objects/sentinel.ts'), 'throw new Error()')
    writeFileSync(join(projectRoot, 'unrelated.ts'), 'throw new Error()')

    expect(
      collectTailwindSourceFiles(projectRoot).map((path) => relative(projectRoot, path)),
    ).toEqual([
      'packages/extension-react/src/index.tsx',
      'src/renderer/src/App.tsx',
      'src/renderer/src/components/helper.ts',
    ])
  })
})
