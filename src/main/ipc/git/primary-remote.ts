import { runGit } from './shared'

export interface PrimaryRemote {
  readonly name: string
  readonly url: string
}

export async function resolvePrimaryRemote(projectPath: string): Promise<PrimaryRemote | null> {
  const originResult = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  if (originResult.code === 0 && originResult.stdout.trim()) {
    return { name: 'origin', url: originResult.stdout.trim() }
  }

  const listResult = await runGit(projectPath, ['remote'])
  if (listResult.code !== 0) return null
  const firstRemote = listResult.stdout.trim().split('\n')[0]?.trim()
  if (!firstRemote) return null
  const urlResult = await runGit(projectPath, ['remote', 'get-url', firstRemote])
  return urlResult.code === 0 && urlResult.stdout.trim()
    ? { name: firstRemote, url: urlResult.stdout.trim() }
    : null
}

export async function resolvePrimaryRemoteUrl(projectPath: string): Promise<string | null> {
  return (await resolvePrimaryRemote(projectPath))?.url ?? null
}
