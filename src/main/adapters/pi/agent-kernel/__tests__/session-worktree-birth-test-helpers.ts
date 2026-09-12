import { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'

export function unrelatedWorktreeGitResult(cwd: string, args: readonly string[]) {
  if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
    return Promise.resolve({
      code: 0,
      stdout: cwd === '/repo' ? '/repo/.git\n' : '/elsewhere/.git\n',
      stderr: '',
    })
  }
  return Promise.resolve({ code: 0, stdout: 'main\n', stderr: '' })
}

export function setupSession(extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SessionId('setup-session'),
    title: 'Setup session',
    projectPath: '/repo',
    environmentMode: 'worktree',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

export function session(
  extra: {
    id?: SessionId
    environmentMode?: SessionEnvironmentMode
    worktreePath?: string | null
    worktreeBaseRef?: string | null
    worktreeStartFromOrigin?: boolean
  } = {},
): SessionDetail {
  return {
    id: SessionId('sess-abcdef12'),
    title: 'S',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}
