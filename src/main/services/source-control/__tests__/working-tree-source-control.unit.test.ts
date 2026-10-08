import type {
  ChangeRequestResult,
  SourceControlRepositoryIdentity,
} from '@shared/types/change-request'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceControlProvider } from '../../../ports/source-control-provider'
import { clearForkParentLookupsForTests, findCurrentChangeRequest } from '../fork-change-requests'
import type { SourceControlSettingsAccess } from '../source-control-settings-access'
import { createSerialSourceControlSettingsAccess } from '../source-control-settings-patch'
import { attentionForFailure, type WorkingTreeSourceControl } from '../working-tree-source-control'

const ORIGIN = { provider: 'github', host: 'github.com', owner: 'jdoe', repository: 'app' } as const
const PARENT = { provider: 'github', host: 'github.com', owner: 'acme', repository: 'app' } as const
const NO_REQUEST: ChangeRequestResult = {
  ok: false,
  code: 'no-change-request',
  message: 'No pull request found for ref.',
}
const FOUND: ChangeRequestResult = {
  ok: true,
  changeRequest: {
    title: 'Fix',
    url: 'https://github.com/acme/app/pull/7',
    baseRef: 'main',
    headRef: 'fix',
    state: 'open',
  },
}

type Stored = Awaited<ReturnType<SourceControlSettingsAccess['read']>>

function memoryAccess(initial: Partial<Stored> = {}) {
  let stored: Stored = {
    changeRequestOpenDestination: DEFAULT_SETTINGS.changeRequestOpenDestination,
    changeRequestOpenDestinationByProject: {},
    sourceControlHostProviders: {},
    sourceControlDetectedHostProviders: {},
    sourceControlRepositoryAccounts: {},
    sourceControlChangeRequestRepositories: {},
    sourceControlProjectDeclarations: {},
    ...initial,
  }
  return {
    access: createSerialSourceControlSettingsAccess({
      read: async () => stored,
      update: async (partial) => {
        stored = { ...stored, ...partial }
      },
    }),
    current: () => stored,
  }
}

function provider(overrides: Partial<SourceControlProvider>): SourceControlProvider {
  return fromPartial<SourceControlProvider>({
    resolveChangeRequestForRef: async () => NO_REQUEST,
    forkParent: async () => ({ ok: true, parent: null }),
    findChangeRequestForForkHead: async () => NO_REQUEST,
    ...overrides,
  })
}

function sourceControlFor(origin: SourceControlProvider): WorkingTreeSourceControl {
  return {
    remote: { name: 'origin', url: 'git@github.com:jdoe/app.git' },
    repository: ORIGIN,
    hostState: { host: 'github.com', provider: 'github', source: 'public-host' },
    info: { id: 'github', host: 'github.com' },
    provider: origin,
    webUrl: 'https://github.com/jdoe/app',
  }
}

describe('finding the current branch change request', () => {
  beforeEach(() => clearForkParentLookupsForTests())

  it('uses the remote repository when it has the request', async () => {
    const origin = provider({ resolveChangeRequestForRef: async () => FOUND })
    const { access } = memoryAccess()

    const found = await findCurrentChangeRequest(
      sourceControlFor(origin),
      '/work',
      'fix',
      access,
      async () => null,
    )

    expect(found.result).toEqual(FOUND)
    expect(found.repository).toEqual(ORIGIN)
  })

  it('finds a fork request in the parent repository and remembers it', async () => {
    const findInParent = vi.fn(async () => FOUND)
    const origin = provider({ forkParent: async () => ({ ok: true, parent: PARENT }) })
    const { access, current } = memoryAccess()
    const createProvider = vi.fn((repository: SourceControlRepositoryIdentity) =>
      repository.owner === 'acme' ? provider({ findChangeRequestForForkHead: findInParent }) : null,
    )

    const found = await findCurrentChangeRequest(
      sourceControlFor(origin),
      '/work',
      'fix',
      access,
      async () => null,
      createProvider,
    )

    expect(found.result).toEqual(FOUND)
    expect(found.repository).toEqual(PARENT)
    expect(findInParent).toHaveBeenCalledWith('/work', {
      ref: 'fix',
      owner: 'jdoe',
      repository: 'jdoe/app',
    })
    expect(current().sourceControlChangeRequestRepositories).toEqual({
      'github.com/jdoe/app': 'github.com/acme/app',
    })
  })

  it('remembers the parent repository as written, since GitLab paths are case-sensitive', async () => {
    const parent = { ...PARENT, owner: 'Acme-Group', repository: 'App' }
    const origin = provider({ forkParent: async () => ({ ok: true, parent }) })
    const { access, current } = memoryAccess()

    await findCurrentChangeRequest(
      sourceControlFor(origin),
      '/work',
      'fix',
      access,
      async () => null,
      () => provider({ findChangeRequestForForkHead: async () => FOUND }),
    )
    const remembered = vi.fn(async () => ({ ok: true, parent: null }) as const)
    const second = await findCurrentChangeRequest(
      sourceControlFor(provider({ forkParent: remembered })),
      '/work',
      'fix',
      access,
      async () => null,
      () => provider({ findChangeRequestForForkHead: async () => FOUND }),
    )

    expect(current().sourceControlChangeRequestRepositories).toEqual({
      'github.com/jdoe/app': 'github.com/Acme-Group/App',
    })
    expect(second.repository).toEqual(parent)
  })

  it('checks an upstream remote on the same host', async () => {
    const origin = provider({})
    const { access } = memoryAccess()
    const createProvider = vi.fn((repository: SourceControlRepositoryIdentity) =>
      repository.owner === 'acme'
        ? provider({ findChangeRequestForForkHead: async () => FOUND })
        : null,
    )

    const found = await findCurrentChangeRequest(
      sourceControlFor(origin),
      '/work',
      'fix',
      access,
      async () => PARENT,
      createProvider,
    )

    expect(found.repository).toEqual(PARENT)
  })

  it('asks for the fork parent only once per repository', async () => {
    const forkParent = vi.fn(async () => ({ ok: true, parent: null }) as const)
    const origin = provider({ forkParent })
    const { access } = memoryAccess()

    await findCurrentChangeRequest(sourceControlFor(origin), '/work', 'a', access, async () => null)
    await findCurrentChangeRequest(sourceControlFor(origin), '/work', 'b', access, async () => null)

    expect(forkParent).toHaveBeenCalledTimes(1)
  })

  it('asks for the fork parent again after a failed lookup', async () => {
    const forkParent = vi
      .fn<SourceControlProvider['forkParent']>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, parent: null })
    const origin = provider({ forkParent })
    const { access } = memoryAccess()

    await findCurrentChangeRequest(sourceControlFor(origin), '/work', 'a', access, async () => null)
    await findCurrentChangeRequest(sourceControlFor(origin), '/work', 'b', access, async () => null)
    await findCurrentChangeRequest(sourceControlFor(origin), '/work', 'c', access, async () => null)

    expect(forkParent).toHaveBeenCalledTimes(2)
  })

  it('does not look elsewhere when the remote failed for another reason', async () => {
    const forkParent = vi.fn(async () => ({ ok: true, parent: PARENT }) as const)
    const failure: ChangeRequestResult = { ok: false, code: 'cli-missing', message: 'gh missing' }
    const origin = provider({ resolveChangeRequestForRef: async () => failure, forkParent })
    const { access } = memoryAccess()

    const found = await findCurrentChangeRequest(
      sourceControlFor(origin),
      '/work',
      'fix',
      access,
      async () => null,
    )

    expect(found.result).toEqual(failure)
    expect(forkParent).not.toHaveBeenCalled()
  })
})

describe('the fix for a CLI failure', () => {
  it('names the CLI to install or the host to sign in to', () => {
    const info = { id: 'gitlab', host: 'git.acme.io' } as const
    expect(attentionForFailure({ ok: false, code: 'cli-missing', message: '' }, info)).toEqual({
      kind: 'cli-missing',
      provider: 'gitlab',
      host: 'git.acme.io',
      cli: 'glab',
    })
    expect(
      attentionForFailure({ ok: false, code: 'not-authenticated', message: '' }, info),
    ).toMatchObject({ kind: 'not-signed-in', provider: 'gitlab', host: 'git.acme.io', cli: 'glab' })
    expect(attentionForFailure({ ok: false, code: 'unknown', message: '' }, info)).toBeNull()
  })
})
