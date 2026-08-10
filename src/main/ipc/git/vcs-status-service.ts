import type {
  LocalVcsStatus,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  VcsChangeRequest,
} from '@shared/types/git'
import { getSourceControlProvider } from '../../adapters/source-control'
import { isGitRepository, runGit } from './shared'
import { GIT_PARSE_INT_RADIX } from './status-constants'
import { buildChangedFiles, parseNumstat, parsePorcelain } from './status-parse'
import { detectSourceControlProvider, parseAheadBehind, toWorkingTree } from './vcs-status-parse'

async function resolveRefName(projectPath: string): Promise<string | null> {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name || null
}

async function resolvePrimaryRemoteUrl(projectPath: string): Promise<string | null> {
  const originResult = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  if (originResult.code === 0 && originResult.stdout.trim()) return originResult.stdout.trim()

  const listResult = await runGit(projectPath, ['remote'])
  if (listResult.code !== 0) return null
  const firstRemote = listResult.stdout.trim().split('\n')[0]?.trim()
  if (!firstRemote) return null
  const urlResult = await runGit(projectPath, ['remote', 'get-url', firstRemote])
  return urlResult.code === 0 ? urlResult.stdout.trim() || null : null
}

async function resolveDefaultRef(projectPath: string): Promise<string | null> {
  const headResult = await runGit(projectPath, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (headResult.code === 0 && headResult.stdout.trim()) {
    return headResult.stdout.trim().replace(/^origin\//, '')
  }
  const configResult = await runGit(projectPath, ['config', '--get', 'init.defaultBranch'])
  if (configResult.code === 0 && configResult.stdout.trim()) return configResult.stdout.trim()
  return null
}

async function resolveWorkingTree(projectPath: string) {
  const [porcelainResult, worktreeNumstat, cachedNumstat] = await Promise.all([
    runGit(projectPath, ['status', '--porcelain=v1']),
    runGit(projectPath, ['diff', '--numstat']),
    runGit(projectPath, ['diff', '--cached', '--numstat']),
  ])
  const numstat = parseNumstat(`${worktreeNumstat.stdout}\n${cachedNumstat.stdout}`)
  const changedFiles = buildChangedFiles(parsePorcelain(porcelainResult.stdout), numstat)
  return toWorkingTree(changedFiles)
}

export async function getLocalVcsStatus(projectPath: string): Promise<LocalVcsStatusResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-a-repo', message: 'Selected folder is not a Git repository.' }
  }

  const [refName, remoteUrl, defaultRef, workingTree] = await Promise.all([
    resolveRefName(projectPath),
    resolvePrimaryRemoteUrl(projectPath),
    resolveDefaultRef(projectPath),
    resolveWorkingTree(projectPath),
  ])

  const status: LocalVcsStatus = {
    isRepo: true,
    sourceControlProvider: detectSourceControlProvider(remoteUrl),
    hasPrimaryRemote: remoteUrl !== null,
    isDefaultRef: refName !== null && defaultRef !== null && refName === defaultRef,
    refName,
    hasWorkingTreeChanges: workingTree.files.length > 0,
    workingTree,
  }
  return { ok: true, status }
}

async function resolveAheadOfDefault(
  projectPath: string,
  refName: string | null,
): Promise<number | null> {
  const defaultRef = await resolveDefaultRef(projectPath)
  if (!defaultRef || !refName || refName === defaultRef) return null
  const result = await runGit(projectPath, ['rev-list', '--count', `origin/${defaultRef}..HEAD`])
  if (result.code !== 0) return null
  const parsed = Number.parseInt(result.stdout.trim(), GIT_PARSE_INT_RADIX)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function getRemoteVcsStatus(projectPath: string): Promise<RemoteVcsStatusResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-a-repo', message: 'Selected folder is not a Git repository.' }
  }

  const fetchResult = await runGit(projectPath, ['fetch', '--quiet'])
  if (fetchResult.code !== 0) {
    return {
      ok: false,
      code: 'remote-unreachable',
      message: fetchResult.stderr.trim() || 'Failed to reach the remote.',
    }
  }

  const upstreamResult = await runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  const hasUpstream = upstreamResult.code === 0 && upstreamResult.stdout.trim().length > 0

  const aheadBehind = hasUpstream
    ? parseAheadBehind(
        (await runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']))
          .stdout,
      )
    : { ahead: 0, behind: 0 }

  const refName = await resolveRefName(projectPath)
  const aheadOfDefaultCount = await resolveAheadOfDefault(projectPath, refName)
  const changeRequest = await resolveOpenChangeRequest(projectPath, refName)

  return {
    ok: true,
    status: {
      hasUpstream,
      aheadCount: aheadBehind.ahead,
      behindCount: aheadBehind.behind,
      aheadOfDefaultCount,
      changeRequest,
    },
  }
}

/**
 * Open change request for the current ref via the source-control provider (WS3).
 * Never fails the whole remote status: any provider/CLI/auth failure maps to null.
 */
async function resolveOpenChangeRequest(
  projectPath: string,
  refName: string | null,
): Promise<VcsChangeRequest | null> {
  if (!refName) return null
  const remote = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null
  const provider = getSourceControlProvider(detectSourceControlProvider(remoteUrl)?.id)
  if (!provider) return null
  const result = await provider.resolveChangeRequestForRef(projectPath, refName)
  return result.ok ? result.changeRequest : null
}
