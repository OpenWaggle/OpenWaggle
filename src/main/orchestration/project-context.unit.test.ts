import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExecutorTools, gatherProjectContext } from './project-context'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('gatherProjectContext', () => {
  it('returns all sections when README, package.json, and source files exist', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        description: 'A cool app',
        dependencies: { react: '^19.0.0', electron: '^33.0.0' },
        devDependencies: { tailwindcss: '^4.0.0', typescript: '^5.0.0' },
        scripts: { dev: 'vite', build: 'tsc && vite build' },
      }),
    )
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# My App\n\nThis is a cool app.')
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'console.log("hello")')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('## Project Context')
    expect(result.text).toContain('### Tech Stack')
    expect(result.text).toContain('Project: my-app')
    expect(result.text).toContain('TypeScript')
    expect(result.text).toContain('React')
    expect(result.text).toContain('Electron')
    expect(result.text).toContain('Tailwind CSS')
    expect(result.text).toContain('### Key Files')
    expect(result.text).toContain('README.md')
    expect(result.text).toContain('This is a cool app')
    expect(result.text).toContain('### File Structure')
    expect(result.text).toContain('src/index.ts')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.rawLength).toBeGreaterThan(0)
  })

  it('produces tree and tech stack even without README', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'no-readme',
        dependencies: { express: '^4.0.0' },
      }),
    )
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'server.ts'), 'export default {}')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('### Tech Stack')
    expect(result.text).toContain('Express')
    expect(result.text).not.toContain('README')
    expect(result.text).toContain('### File Structure')
    expect(result.text).toContain('src/server.ts')
  })

  it('returns empty context for null projectPath', async () => {
    const result = await gatherProjectContext(null)

    expect(result.text).toBe('')
    expect(result.rawLength).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it('truncates large README to per-file cap', async () => {
    const longContent = 'A'.repeat(5000)
    await fs.writeFile(path.join(tmpDir, 'README.md'), longContent)
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'big-readme' }))

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('README.md')
    // The full 5000-char content should be truncated
    const readmeSection = result.text.split('--- README.md ---')[1] ?? ''
    expect(readmeSection.length).toBeLessThan(5000)
    expect(readmeSection).toContain('...')
  })

  it('detects build tools from dependencies', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'vite-app',
        devDependencies: { vite: '^5.0.0' },
      }),
    )

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Build: Vite')
  })

  it('detects electron-vite as build tool', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'electron-app',
        devDependencies: { 'electron-vite': '^2.0.0', vite: '^5.0.0' },
      }),
    )

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Build: electron-vite')
  })

  it('ignores node_modules and .git in tree', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
    await fs.mkdir(path.join(tmpDir, 'node_modules', 'foo'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'foo', 'index.js'), '')
    await fs.mkdir(path.join(tmpDir, '.git', 'objects'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.git', 'objects', 'abc'), '')
    await fs.writeFile(path.join(tmpDir, 'index.ts'), '')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('index.ts')
    expect(result.text).not.toContain('node_modules')
    expect(result.text).not.toContain('.git')
  })

  it('handles missing package.json gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Hello')

    const result = await gatherProjectContext(tmpDir)

    // Should still have file structure and key files, just no tech stack
    expect(result.text).toContain('README.md')
    expect(result.text).toContain('Hello')
  })
})

describe('createExecutorTools', () => {
  it('returns empty array for null projectPath', () => {
    const tools = createExecutorTools(null)
    expect(tools).toEqual([])
  })

  it('returns readFile and glob tools for valid projectPath', () => {
    const tools = createExecutorTools(tmpDir)
    expect(tools).toHaveLength(2)
  })

  it('readFile tool can read a file', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world')
    const tools = createExecutorTools(tmpDir)
    const readFileTool = tools[0]

    // Execute the tool by calling it directly (ServerTool has an execute method)
    const result = await (readFileTool as { execute: (args: unknown) => Promise<unknown> }).execute(
      {
        path: 'test.txt',
      },
    )
    expect(result).toEqual({ kind: 'text', text: 'hello world' })
  })

  it('readFile tool rejects paths outside project', async () => {
    const tools = createExecutorTools(tmpDir)
    const readFileTool = tools[0]

    const result = await (readFileTool as { execute: (args: unknown) => Promise<unknown> }).execute(
      {
        path: '../../../etc/passwd',
      },
    )
    expect(result).toEqual({
      kind: 'text',
      text: 'Error: path is outside the project directory',
    })
  })

  it('glob tool finds files', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'app.ts'), '')
    await fs.writeFile(path.join(tmpDir, 'src', 'utils.ts'), '')

    const tools = createExecutorTools(tmpDir)
    const globTool = tools[1]

    const result = (await (globTool as { execute: (args: unknown) => Promise<unknown> }).execute({
      pattern: 'src/*.ts',
    })) as { kind: string; text: string }
    expect(result.kind).toBe('text')
    expect(result.text).toContain('src/app.ts')
    expect(result.text).toContain('src/utils.ts')
  })
})
