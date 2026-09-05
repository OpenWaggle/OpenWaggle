import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  ensureLocalSessionHost,
  type LocalSessionHostLauncherDependencies,
} from '../local-session-host-launcher'

const paths = {
  stateRoot: '/state',
  legacyDatabasePath: '/state/legacy.sqlite',
  databasePath: '/state/host.sqlite',
  recoveryDatabasePath: '/state/recovery.sqlite',
  credentialPath: '/state/credential',
  endpoint: '/state/host.sock',
  endpointDirectory: '/state',
  endpointCapabilityPath: null,
}

const client = {
  paths,
  clientKind: 'cli' as const,
  clientVersion: 'current',
  supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
}

function dependencies(input: {
  readonly canConnect?: LocalSessionHostLauncherDependencies['canConnect']
  readonly probe?: LocalSessionHostLauncherDependencies['probe']
  readonly tryAcquireOwnership: LocalSessionHostLauncherDependencies['tryAcquireOwnership']
}) {
  let now = 0
  return {
    canConnect: input.canConnect ?? vi.fn(async () => false),
    probe: input.probe ?? vi.fn(),
    tryAcquireOwnership: input.tryAcquireOwnership,
    launch: vi.fn(),
    now: () => now,
    refreshPaths: vi.fn(async (candidate) => candidate),
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  } satisfies LocalSessionHostLauncherDependencies
}

describe('Local Session Host launcher cancellation', () => {
  it('does not launch a detached Host after ensure is aborted during ownership probing', async () => {
    const controller = new AbortController()
    let resolveOwnership:
      | ((
          ownership: Awaited<
            ReturnType<LocalSessionHostLauncherDependencies['tryAcquireOwnership']>
          >,
        ) => void)
      | undefined
    let reportOwnershipProbe: (() => void) | undefined
    const ownershipProbeStarted = new Promise<void>((resolve) => {
      reportOwnershipProbe = resolve
    })
    const release = vi.fn(async () => undefined)
    const tryAcquireOwnership = vi.fn(async () => {
      reportOwnershipProbe?.()
      return new Promise<
        Awaited<ReturnType<LocalSessionHostLauncherDependencies['tryAcquireOwnership']>>
      >((resolve) => {
        resolveOwnership = resolve
      })
    })
    const launcher = dependencies({ tryAcquireOwnership })
    const ensuring = ensureLocalSessionHost({ ...client, signal: controller.signal }, launcher)

    await ownershipProbeStarted
    controller.abort()
    resolveOwnership?.({ targetPath: paths.databasePath, release })

    await expect(ensuring).rejects.toMatchObject({ name: 'AbortError' })
    expect(release).toHaveBeenCalledOnce()
    expect(launcher.launch).not.toHaveBeenCalled()
  })

  it('cancels a pending launcher poll wait', async () => {
    const controller = new AbortController()
    let reportWait: (() => void) | undefined
    const waitStarted = new Promise<void>((resolve) => {
      reportWait = resolve
    })
    const launcher = dependencies({ tryAcquireOwnership: vi.fn(async () => null) })
    launcher.wait = vi.fn(async () => {
      reportWait?.()
      return new Promise<void>(() => {})
    })
    const ensuring = ensureLocalSessionHost({ ...client, signal: controller.signal }, launcher)

    await waitStarted
    controller.abort()

    await expect(ensuring).rejects.toMatchObject({ name: 'AbortError' })
    expect(launcher.launch).not.toHaveBeenCalled()
  })

  it('passes cancellation through an in-flight Host compatibility probe', async () => {
    const controller = new AbortController()
    let reportProbe: (() => void) | undefined
    const probeStarted = new Promise<void>((resolve) => {
      reportProbe = resolve
    })
    let probeSignal: AbortSignal | undefined
    const probe = vi.fn(async (input: { readonly signal?: AbortSignal }) => {
      probeSignal = input.signal
      reportProbe?.()
      return new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true })
      })
    })
    const launcher = dependencies({
      canConnect: vi.fn(async () => true),
      probe,
      tryAcquireOwnership: vi.fn(async () => null),
    })
    const ensuring = ensureLocalSessionHost({ ...client, signal: controller.signal }, launcher)

    await probeStarted
    controller.abort()

    await expect(ensuring).rejects.toMatchObject({ name: 'AbortError' })
    expect(probeSignal?.aborted).toBe(true)
    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
