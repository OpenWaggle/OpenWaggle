import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildIgnorePatterns, createExecutorTools, gatherProjectContext } from '../project-context'

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
    expect(result.text).toContain('Ecosystem: JavaScript/Node.js, TypeScript')
    expect(result.text).toContain('### Key Files')
    expect(result.text).toContain('README.md')
    expect(result.text).toContain('This is a cool app')
    expect(result.text).toContain('### File Structure')
    expect(result.text).toContain('src/index.ts')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.rawLength).toBeGreaterThan(0)
  })

  it('orders key files with AGENTS before CLAUDE after README and package summary', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'order-test',
        scripts: { test: 'vitest' },
      }),
    )
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Order Test')
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# AGENTS rules')

    const result = await gatherProjectContext(tmpDir)

    const readmeIndex = result.text.indexOf('--- README.md ---')
    const packageSummaryIndex = result.text.indexOf('--- package.json (summary) ---')
    const agentsIndex = result.text.indexOf('--- AGENTS.md ---')

    expect(readmeIndex).toBeGreaterThanOrEqual(0)
    expect(packageSummaryIndex).toBeGreaterThan(readmeIndex)
    expect(agentsIndex).toBeGreaterThan(packageSummaryIndex)
    expect(result.text).not.toContain('CLAUDE.md')
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
    expect(result.text).toContain('Ecosystem: JavaScript/Node.js')
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

  it('detects build tools from config files', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'vite-app' }))
    await fs.writeFile(path.join(tmpDir, 'vite.config.ts'), 'export default {}')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Build: Vite')
  })

  it('detects electron-vite as build tool', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'electron-app' }))
    await fs.writeFile(path.join(tmpDir, 'electron.vite.config.ts'), 'export default {}')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Build: electron-vite')
  })

  it('ignores node_modules and .git in tree via .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n')
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

  it('detects Python project via pyproject.toml', async () => {
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "my-py"')
    await fs.writeFile(path.join(tmpDir, 'poetry.lock'), '')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Ecosystem: Python')
    expect(result.text).toContain('Package manager: Poetry')
  })

  it('detects Rust project via Cargo.toml', async () => {
    await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "my-rs"')
    await fs.writeFile(path.join(tmpDir, 'Cargo.lock'), '')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Ecosystem: Rust')
    expect(result.text).toContain('Package manager: Cargo')
  })

  it('detects Go project via go.mod', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module example.com/foo')
    await fs.writeFile(path.join(tmpDir, 'go.sum'), '')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Ecosystem: Go')
    expect(result.text).toContain('Package manager: Go')
  })

  it('detects mixed ecosystem with both package.json and Cargo.toml', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'mixed-project' }))
    await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "wasm-lib"')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('JavaScript/Node.js')
    expect(result.text).toContain('Rust')
  })

  it('detects pnpm package manager from lock file', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'pnpm-project' }))
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '')

    const result = await gatherProjectContext(tmpDir)

    expect(result.text).toContain('Package manager: pnpm')
  })
})

describe('buildIgnorePatterns', () => {
  it('returns only .git/** when no .gitignore exists', async () => {
    const patterns = await buildIgnorePatterns(tmpDir)
    expect(patterns).toEqual(['.git/**'])
  })

  it('converts directory patterns to glob format', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n')

    const patterns = await buildIgnorePatterns(tmpDir)

    expect(patterns).toContain('.git/**')
    expect(patterns).toContain('node_modules/**')
    expect(patterns).toContain('dist/**')
  })

  it('handles unanchored patterns by prepending **/', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '*.log\n.env\n')

    const patterns = await buildIgnorePatterns(tmpDir)

    expect(patterns).toContain('**/*.log')
    expect(patterns).toContain('**/.env')
  })

  it('strips leading / from root-anchored patterns', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '/build\n')

    const patterns = await buildIgnorePatterns(tmpDir)

    expect(patterns).toContain('build')
  })

  it('skips comments, empty lines, and negation patterns', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.gitignore'),
      '# Comment\n\nnode_modules/\n!important.log\n',
    )

    const patterns = await buildIgnorePatterns(tmpDir)

    expect(patterns).toEqual(['.git/**', 'node_modules/**'])
  })

  it('passes through relative paths with directory components', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'src/generated\n')

    const patterns = await buildIgnorePatterns(tmpDir)

    expect(patterns).toContain('src/generated')
  })
})

describe('createExecutorTools', () => {
  it('returns empty array for null projectPath', async () => {
    const tools = await createExecutorTools(null)
    expect(tools).toEqual([])
  })

  it('returns readFile, glob, and webFetch tools for valid projectPath', async () => {
    const tools = await createExecutorTools(tmpDir)
    expect(tools).toHaveLength(3)
  })

  it('readFile tool can read a file', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world')
    const tools = await createExecutorTools(tmpDir)
    const readFileTool = tools[0]

    const result = await (readFileTool as { execute: (args: unknown) => Promise<unknown> }).execute(
      {
        path: 'test.txt',
      },
    )
    expect(result).toEqual({ kind: 'text', text: 'hello world' })
  })

  it('readFile tool rejects paths outside project', async () => {
    const tools = await createExecutorTools(tmpDir)
    const readFileTool = tools[0]

    const result = await (readFileTool as { execute: (args: unknown) => Promise<unknown> }).execute(
      {
        path: '../../../../etc/passwd',
      },
    )
    expect(result).toEqual({
      kind: 'text',
      text: 'Error: path is outside the project directory',
    })
  })

  it('readFile tool blocks gitignored files like .env', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '.env\n')
    await fs.writeFile(path.join(tmpDir, '.env'), 'SECRET_KEY=leaked')
    const tools = await createExecutorTools(tmpDir)
    const readFileTool = tools[0]

    const result = await (readFileTool as { execute: (args: unknown) => Promise<unknown> }).execute(
      {
        path: '.env',
      },
    )
    expect(result).toEqual({
      kind: 'text',
      text: 'Error: file is excluded by project ignore patterns (.gitignore)',
    })
  })

  it('glob tool excludes gitignored files', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '.env\n')
    await fs.writeFile(path.join(tmpDir, '.env'), 'SECRET=leaked')
    await fs.writeFile(path.join(tmpDir, 'index.ts'), '')
    const tools = await createExecutorTools(tmpDir)
    const globTool = tools[1]

    const result = (await (globTool as { execute: (args: unknown) => Promise<unknown> }).execute({
      pattern: '**/*',
    })) as { kind: string; text: string }
    expect(result.text).toContain('index.ts')
    expect(result.text).not.toContain('.env')
  })

  it('webFetch tool returns error for failed fetch', async () => {
    const tools = await createExecutorTools(tmpDir)
    const webFetchTool = tools[2]

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND bad.invalid'))

    try {
      const result = (await (
        webFetchTool as { execute: (args: unknown) => Promise<unknown> }
      ).execute({
        url: 'https://bad.invalid',
      })) as { kind: string; text: string }
      expect(result.kind).toBe('text')
      expect(result.text).toContain('Error fetching URL:')
      expect(result.text).toContain('ENOTFOUND')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('webFetch tool returns HTTP error status as text', async () => {
    const tools = await createExecutorTools(tmpDir)
    const webFetchTool = tools[2]

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }))

    try {
      const result = (await (
        webFetchTool as { execute: (args: unknown) => Promise<unknown> }
      ).execute({
        url: 'https://example.com/missing',
      })) as { kind: string; text: string }
      expect(result.kind).toBe('text')
      expect(result.text).toContain('HTTP 404')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('webFetch tool strips HTML and returns plain text', async () => {
    const tools = await createExecutorTools(tmpDir)
    const webFetchTool = tools[2]

    const htmlBody = '<html><head><title>Test</title></head><body><p>Hello world</p></body></html>'
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(htmlBody, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    try {
      const result = (await (
        webFetchTool as { execute: (args: unknown) => Promise<unknown> }
      ).execute({
        url: 'https://example.com',
      })) as { kind: string; text: string }
      expect(result.kind).toBe('text')
      expect(result.text).toContain('Hello world')
      expect(result.text).not.toContain('<p>')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('glob tool finds files', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'app.ts'), '')
    await fs.writeFile(path.join(tmpDir, 'src', 'utils.ts'), '')

    const tools = await createExecutorTools(tmpDir)
    const globTool = tools[1]

    const result = (await (globTool as { execute: (args: unknown) => Promise<unknown> }).execute({
      pattern: 'src/*.ts',
    })) as { kind: string; text: string }
    expect(result.kind).toBe('text')
    expect(result.text).toContain('src/app.ts')
    expect(result.text).toContain('src/utils.ts')
  })
})
