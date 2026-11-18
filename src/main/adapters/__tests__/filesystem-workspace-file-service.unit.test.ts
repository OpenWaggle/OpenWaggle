import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFileFixture,
  removeWorkspaceFileFixture,
  runWithWorkspaceFiles,
} from './filesystem-workspace-file-service-test-harness'

describe('FilesystemWorkspaceFileLive', () => {
  let temporaryRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    ;({ temporaryRoot, projectPath } = await createWorkspaceFileFixture())
  })

  afterEach(async () => {
    await removeWorkspaceFileFixture(temporaryRoot)
  })

  it('fuzzy-searches source and dot files while excluding generated dependencies', async () => {
    const sourceResults = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: 'alp', limit: 20 }),
    )
    const allResults = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )

    expect(sourceResults[0]?.path).toBe('src/alpha.ts')
    expect(allResults.map((entry) => entry.path)).toContain('.agents/guide.md')
    expect(allResults.map((entry) => entry.path)).not.toContain('node_modules/ignored/package.js')
  })

  it('accepts only absolute regular-file targets for external-editor launches', async () => {
    await expect(
      runWithWorkspaceFiles((service) =>
        service.openAbsoluteFile({ path: 'src/alpha.ts', editor: 'vscode' }),
      ),
    ).rejects.toThrow('File path must be absolute')

    await expect(
      runWithWorkspaceFiles((service) =>
        service.openAbsoluteFile({ path: projectPath, editor: 'vscode' }),
      ),
    ).rejects.toThrow('Path must resolve to a file')
  })

  it('applies nested generated-directory and gitignore rules with re-inclusions', async () => {
    await fs.mkdir(path.join(projectPath, 'packages', 'app', 'node_modules', 'dep'), {
      recursive: true,
    })
    await fs.mkdir(path.join(projectPath, 'packages', 'app', 'dist'), { recursive: true })
    await Promise.all([
      fs.writeFile(
        path.join(projectPath, 'packages', 'app', 'node_modules', 'dep', 'index.js'),
        'ignored\n',
      ),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'dist', 'bundle.js'), 'ignored\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', '.gitignore'), '*.log\n!keep.log\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'debug.log'), 'ignored\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'keep.log'), 'included\n'),
    ])

    const results = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )
    const paths = results.map((entry) => entry.path)

    expect(paths).not.toContain('packages/app/node_modules/dep/index.js')
    expect(paths).not.toContain('packages/app/dist/bundle.js')
    expect(paths).not.toContain('packages/app/debug.log')
    expect(paths).toContain('packages/app/keep.log')
  })

  it('does not let a child gitignore re-include files beneath a parent-ignored directory', async () => {
    await fs.mkdir(path.join(projectPath, 'ignored'), { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(projectPath, '.gitignore'), 'ignored/\n'),
      fs.writeFile(path.join(projectPath, 'ignored', '.gitignore'), '!keep.ts\n'),
      fs.writeFile(path.join(projectPath, 'ignored', 'keep.ts'), 'export const keep = true\n'),
    ])

    const results = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )

    expect(results.map((entry) => entry.path)).not.toContain('ignored/keep.ts')
  })

  it('routes text beyond 1 MiB to the paged read-only source view', async () => {
    await fs.writeFile(path.join(projectPath, 'src', 'large.txt'), 'x'.repeat(1024 * 1024 + 1))

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.txt' }),
    )

    expect(result).toMatchObject({
      previewKind: 'oversized',
      reason: 'This text file is larger than 1 MiB. Browse it in paged source view.',
    })
  })

  it('keeps image previews available beyond the focused text-edit limit', async () => {
    const image = Buffer.alloc(1024 * 1024 + 1, 1)
    await fs.writeFile(path.join(projectPath, 'src', 'large.png'), image)

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.png' }),
    )

    expect(result).toMatchObject({
      previewKind: 'image',
      mimeType: 'image/png',
      size: image.byteLength,
    })
    if (result.previewKind !== 'image') throw new Error('Expected an image preview.')
    expect(result.data).toHaveLength(image.byteLength)
  })

  it('honours worktree-local VS Code file associations', async () => {
    await fs.mkdir(path.join(projectPath, '.vscode'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      `{
        // Keep the standard users already configured in VS Code.
        "files.associations": {
          "*.theme": "typescript",
          "**/*.templ": "html",
          "config/*.conf": "toml",
          "*.{spec,test}": "javascript"
        }
      }`,
    )
    await fs.mkdir(path.join(projectPath, 'config'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'src', 'ocean.theme'), 'export const blue = true\n')
    await fs.writeFile(path.join(projectPath, 'src', 'math.spec'), 'export const sum = 2\n')
    await fs.writeFile(path.join(projectPath, 'src', 'large.theme'), 'x'.repeat(1024 * 1024 + 1))
    await fs.writeFile(path.join(projectPath, 'page.templ'), '<main>Root</main>\n')
    await fs.writeFile(path.join(projectPath, 'src', 'page.templ'), '<main>Nested</main>\n')
    await fs.writeFile(path.join(projectPath, 'config', 'app.conf'), 'enabled = true\n')

    const theme = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/ocean.theme' }),
    )
    const config = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'config/app.conf' }),
    )
    const testFile = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/math.spec' }),
    )
    const rootTemplate = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'page.templ' }),
    )
    const nestedTemplate = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/page.templ' }),
    )
    const largeTheme = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.theme' }),
    )
    const largeThemePage = await runWithWorkspaceFiles((service) =>
      service.readPage({ projectPath, path: 'src/large.theme', offset: 0, limit: 64 }),
    )

    expect(theme).toMatchObject({ previewKind: 'text', language: 'typescript' })
    expect(config).toMatchObject({ previewKind: 'text', language: 'toml' })
    expect(testFile).toMatchObject({ previewKind: 'text', language: 'javascript' })
    expect(rootTemplate).toMatchObject({ previewKind: 'text', language: 'html' })
    expect(nestedTemplate).toMatchObject({ previewKind: 'text', language: 'html' })
    expect(largeTheme).toMatchObject({ previewKind: 'oversized', language: 'typescript' })
    expect(largeThemePage).toMatchObject({ language: 'typescript' })
  })
})
