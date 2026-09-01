import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

const SOURCE_PLACEHOLDER = '__OPENWAGGLE_TAILWIND_SOURCE__'
const WORKSPACE_ID_LENGTH = 12
const SOURCE_EXTENSIONS = new Set(['.html', '.js', '.jsx', '.ts', '.tsx'])
const SOURCE_DIRECTORIES = ['src/renderer/src', 'packages/extension-react/src'] as const

function ignoredSourcePath(path: string) {
  const segments = path.split(sep)
  const basename = segments.at(-1) ?? ''
  return (
    segments.includes('__tests__') ||
    basename.includes('.test.') ||
    basename.includes('.spec.') ||
    !SOURCE_EXTENSIONS.has(extname(basename))
  )
}

export function collectTailwindSourceFiles(projectRoot: string) {
  const files: string[] = []
  const pending = SOURCE_DIRECTORIES.map((directory) => resolve(projectRoot, directory))
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) break
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (entry.isFile() && !ignoredSourcePath(path)) files.push(path)
    }
  }
  return files.sort()
}

function combinedTailwindSource(projectRoot: string) {
  return collectTailwindSourceFiles(projectRoot)
    .map((path) => `\n/* ${relative(projectRoot, path)} */\n${readFileSync(path, 'utf8')}`)
    .join('')
}

function isolatedSourcePath(projectRoot: string) {
  const workspaceId = createHash('sha256')
    .update(projectRoot)
    .digest('hex')
    .slice(0, WORKSPACE_ID_LENGTH)
  const directory = join(tmpdir(), 'openwaggle-tailwind-sources')
  mkdirSync(directory, { recursive: true })
  return join(directory, `renderer-${workspaceId}.txt`)
}

function refreshIsolatedSource(projectRoot: string, targetPath: string) {
  const content = combinedTailwindSource(projectRoot)
  try {
    if (statSync(targetPath).isFile() && readFileSync(targetPath, 'utf8') === content) return false
  } catch {
    // The first refresh creates the source file.
  }
  writeFileSync(targetPath, content)
  return true
}

function isRegisteredSource(projectRoot: string, path: string) {
  if (ignoredSourcePath(path)) return false
  return SOURCE_DIRECTORIES.some((directory) => {
    const sourceRoot = `${resolve(projectRoot, directory)}${sep}`
    return path.startsWith(sourceRoot)
  })
}

export function isolatedTailwindSourcePlugin(): Plugin {
  const projectRoot = process.cwd()
  const sourcePath = isolatedSourcePath(projectRoot)
  return {
    name: 'openwaggle:isolated-tailwind-source',
    enforce: 'pre',
    configResolved() {
      refreshIsolatedSource(projectRoot, sourcePath)
    },
    configureServer(server) {
      server.watcher.add(sourcePath)
      const refresh = (path: string) => {
        if (isRegisteredSource(projectRoot, path)) refreshIsolatedSource(projectRoot, sourcePath)
      }
      server.watcher.on('add', refresh)
      server.watcher.on('change', refresh)
      server.watcher.on('unlink', refresh)
      return () => {
        server.watcher.off('add', refresh)
        server.watcher.off('change', refresh)
        server.watcher.off('unlink', refresh)
      }
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/renderer/src/styles/globals.css')) return null
      const cssPath = sourcePath.replaceAll('\\', '/')
      return code.replace(SOURCE_PLACEHOLDER, cssPath)
    },
  }
}
