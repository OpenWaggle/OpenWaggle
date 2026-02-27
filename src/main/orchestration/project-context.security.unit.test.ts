/**
 * Security regression tests for orchestration executor tools.
 *
 * These tests verify that `.gitignore`-based filtering prevents orchestration
 * executors from reading or discovering sensitive files (secrets, credentials,
 * dependency trees, build artifacts).
 *
 * Any change to `createExecutorTools` or `buildIgnorePatterns` must pass these.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExecutorTools } from './project-context'

type ExecutableTool = { execute: (args: unknown) => Promise<{ kind: string; text: string }> }

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'executor-security-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/**
 * Writes a .gitignore and a set of files, then returns the executor tools.
 */
async function setupProject(gitignoreContent: string, files: Record<string, string>) {
  await fs.writeFile(path.join(tmpDir, '.gitignore'), gitignoreContent)
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
  }
  return createExecutorTools(tmpDir)
}

describe('executor tool security: readFile blocks gitignored secrets', () => {
  it('blocks .env', async () => {
    const tools = await setupProject('.env\n', {
      '.env': 'API_KEY=sk-secret-123',
      'index.ts': 'console.log("ok")',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: '.env' })

    expect(result.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')
  })

  it('blocks .env.local', async () => {
    const tools = await setupProject('.env.local\n', {
      '.env.local': 'DB_PASSWORD=hunter2',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: '.env.local' })

    expect(result.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')
  })

  it('blocks .env.production via wildcard pattern', async () => {
    const tools = await setupProject('.env*\n', {
      '.env.production': 'STRIPE_KEY=sk_live_xxx',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: '.env.production' })

    expect(result.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')
  })

  it('blocks files inside node_modules/', async () => {
    const tools = await setupProject('node_modules/\n', {
      'node_modules/secret-pkg/index.js': 'module.exports = {}',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: 'node_modules/secret-pkg/index.js' })

    expect(result.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')
  })

  it('blocks .git/ contents even without .gitignore entry', async () => {
    // .git/** is always ignored regardless of .gitignore
    const tools = await setupProject('', {
      '.git/config': '[core]\nrepositoryformatversion = 0',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: '.git/config' })

    expect(result.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')
  })

  it('allows reading non-ignored files', async () => {
    const tools = await setupProject('.env\nnode_modules/\n', {
      '.env': 'SECRET=leaked',
      'src/index.ts': 'console.log("hello")',
    })
    const readFile = tools[0] as ExecutableTool

    const result = await readFile.execute({ path: 'src/index.ts' })

    expect(result.text).toBe('console.log("hello")')
  })
})

describe('executor tool security: glob excludes gitignored files', () => {
  it('excludes .env files from glob results', async () => {
    const tools = await setupProject('.env\n', {
      '.env': 'SECRET=leaked',
      'index.ts': '',
    })
    const glob = tools[1] as ExecutableTool

    const result = await glob.execute({ pattern: '**/*' })

    expect(result.text).toContain('index.ts')
    expect(result.text).not.toContain('.env')
  })

  it('excludes node_modules from glob results', async () => {
    const tools = await setupProject('node_modules/\n', {
      'node_modules/pkg/index.js': '',
      'src/app.ts': '',
    })
    const glob = tools[1] as ExecutableTool

    const result = await glob.execute({ pattern: '**/*' })

    expect(result.text).toContain('src/app.ts')
    expect(result.text).not.toContain('node_modules')
  })

  it('excludes .git from glob results without explicit .gitignore entry', async () => {
    const tools = await setupProject('', {
      '.git/HEAD': 'ref: refs/heads/main',
      'README.md': '# Hello',
    })
    const glob = tools[1] as ExecutableTool

    const result = await glob.execute({ pattern: '**/*' })

    expect(result.text).toContain('README.md')
    expect(result.text).not.toContain('.git')
  })

  it('excludes build artifacts matched by .gitignore', async () => {
    const tools = await setupProject('dist/\nbuild/\ncoverage/\n', {
      'dist/bundle.js': '',
      'build/output.js': '',
      'coverage/lcov.info': '',
      'src/main.ts': '',
    })
    const glob = tools[1] as ExecutableTool

    const result = await glob.execute({ pattern: '**/*' })

    expect(result.text).toContain('src/main.ts')
    expect(result.text).not.toContain('dist/')
    expect(result.text).not.toContain('build/')
    expect(result.text).not.toContain('coverage/')
  })
})

describe('executor tool security: fallback without .gitignore', () => {
  it('still blocks .git/ when no .gitignore exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.git', 'config'), '[core]')
    await fs.writeFile(path.join(tmpDir, 'index.ts'), '')

    const tools = await createExecutorTools(tmpDir)
    const readFile = tools[0] as ExecutableTool
    const glob = tools[1] as ExecutableTool

    const readResult = await readFile.execute({ path: '.git/config' })
    expect(readResult.text).toBe('Error: file is excluded by project ignore patterns (.gitignore)')

    const globResult = await glob.execute({ pattern: '**/*' })
    expect(globResult.text).toContain('index.ts')
    expect(globResult.text).not.toContain('.git')
  })

  it('allows all non-.git files when no .gitignore exists', async () => {
    await fs.writeFile(path.join(tmpDir, '.env'), 'KEY=value')
    await fs.writeFile(path.join(tmpDir, 'index.ts'), 'ok')

    const tools = await createExecutorTools(tmpDir)
    const readFile = tools[0] as ExecutableTool

    // Without .gitignore, .env is NOT blocked (project owner must gitignore secrets)
    const envResult = await readFile.execute({ path: '.env' })
    expect(envResult.text).toBe('KEY=value')

    const tsResult = await readFile.execute({ path: 'index.ts' })
    expect(tsResult.text).toBe('ok')
  })
})
