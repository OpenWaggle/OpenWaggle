import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { z } from 'zod'
import { createLogger } from '../logger'
import { atomicWriteJSON } from '../utils/atomic-write'

const logger = createLogger('worktree')

const WorktreeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  branch: z.string(),
  createdAt: z.number(),
})

type WorktreeEntry = z.infer<typeof WorktreeEntrySchema>

const WORKTREES_DIR = '.openwaggle/worktrees'
const REGISTRY_FILE = '.registry.json'

async function loadRegistry(projectPath: string): Promise<WorktreeEntry[]> {
  const registryPath = path.join(projectPath, WORKTREES_DIR, REGISTRY_FILE)
  try {
    const raw = await fs.readFile(registryPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return z.array(WorktreeEntrySchema).parse(parsed)
  } catch {
    return []
  }
}

async function saveRegistry(projectPath: string, entries: readonly WorktreeEntry[]): Promise<void> {
  const registryPath = path.join(projectPath, WORKTREES_DIR, REGISTRY_FILE)
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  await atomicWriteJSON(registryPath, entries)
}

function runGit(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error.message}`))
        return
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

export async function createWorktree(
  projectPath: string,
  name: string,
): Promise<{ worktreePath: string; branch: string }> {
  const worktreePath = path.join(projectPath, WORKTREES_DIR, name)
  const branch = `agent/${name}`

  await fs.mkdir(path.dirname(worktreePath), { recursive: true })

  await runGit(['worktree', 'add', worktreePath, '-b', branch], projectPath)

  // Register worktree
  const registry = await loadRegistry(projectPath)
  registry.push({ name, path: worktreePath, branch, createdAt: Date.now() })
  await saveRegistry(projectPath, registry)

  logger.info('Worktree created', { name, worktreePath, branch })
  return { worktreePath, branch }
}

export async function hasWorktreeChanges(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(['status', '--porcelain'], worktreePath)
    return stdout.length > 0
  } catch {
    return false
  }
}

export async function cleanupWorktree(projectPath: string, name: string): Promise<void> {
  const worktreePath = path.join(projectPath, WORKTREES_DIR, name)
  const branch = `agent/${name}`

  try {
    await runGit(['worktree', 'remove', worktreePath, '--force'], projectPath)
  } catch (error) {
    logger.warn('Failed to remove worktree via git', {
      name,
      error: formatErrorMessage(error),
    })
    // Fallback: remove directory directly
    try {
      await fs.rm(worktreePath, { recursive: true })
      await runGit(['worktree', 'prune'], projectPath)
    } catch {
      // Best effort
    }
  }

  // Remove branch
  try {
    await runGit(['branch', '-D', branch], projectPath)
  } catch {
    // Branch may not exist
  }

  // Update registry
  const registry = await loadRegistry(projectPath)
  const updated = registry.filter((e) => e.name !== name)
  await saveRegistry(projectPath, updated)

  logger.info('Worktree cleaned up', { name })
}

export async function cleanupOrphanWorktrees(projectPath: string): Promise<void> {
  const registry = await loadRegistry(projectPath)
  if (registry.length === 0) return

  let orphanCount = 0
  const surviving: WorktreeEntry[] = []

  for (const entry of registry) {
    try {
      await fs.stat(entry.path)
      surviving.push(entry)
    } catch (error) {
      if (isEnoent(error)) {
        orphanCount++
        try {
          await runGit(['branch', '-D', entry.branch], projectPath)
        } catch {
          // Branch already gone
        }
      } else {
        surviving.push(entry)
      }
    }
  }

  if (orphanCount > 0) {
    await saveRegistry(projectPath, surviving)
    try {
      await runGit(['worktree', 'prune'], projectPath)
    } catch {
      // Best effort
    }
    logger.info('Cleaned up orphan worktrees', { orphanCount })
  }
}
