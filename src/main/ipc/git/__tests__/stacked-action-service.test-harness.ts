import { vi } from 'vitest'
import type { StackedActionDeps } from '../stacked-action-service'

export function makeDeps(overrides: Partial<StackedActionDeps> = {}): StackedActionDeps {
  return {
    hasWorkingTreeChanges: vi.fn(async () => ({ ok: true, hasChanges: true }) as const),
    listBranchNames: vi.fn(async () => ['main']),
    createBranch: vi.fn(async () => ({ ok: true, message: 'created' })),
    commit: vi.fn(async () => ({ ok: true, commitHash: 'abc', summary: 'done' }) as const),
    push: vi.fn(async () => ({ ok: true, code: 'ok', message: 'pushed' }) as const),
    pull: vi.fn(async () => ({ ok: true, code: 'ok', message: 'pulled' }) as const),
    openChangeRequest: vi.fn(
      async () =>
        ({
          ok: true,
          changeRequest: {
            title: 'T',
            url: 'https://x/pull/1',
            baseRef: 'main',
            headRef: 'feature/update',
            state: 'open' as const,
          },
        }) as const,
    ),
    resolveCurrentRef: vi.fn(async () => 'feature/current'),
    resolveDefaultBaseRef: vi.fn(async () => 'main'),
    resolvePrimaryRemoteUrl: vi.fn(async () => 'https://github.com/upstream/project.git'),
    preflightChangeRequest: vi.fn(
      async () =>
        ({
          ok: true,
          status: { authenticated: true, account: 'octocat', host: 'github.com' },
        }) as const,
    ),
    buildChangeRequestFallbackUrl: vi.fn(async () => 'https://example.test/new-change-request'),
    ...overrides,
  }
}
