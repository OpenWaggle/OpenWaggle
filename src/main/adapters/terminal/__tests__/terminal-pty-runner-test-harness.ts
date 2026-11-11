import type { Pty, PtyModule, PtySpawnOptions } from '../terminal-pty-backend'
import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import { makePtyRunner, type PtySpawnRequest } from '../terminal-pty-runner'
import type { TerminalShellCandidate } from '../terminal-shell'

const spawnMock = vi.hoisted(() =>
  vi.fn<(file: string, args: readonly string[], options: PtySpawnOptions) => Pty>(),
)
const getInteractiveTerminalEnvMock = vi.hoisted(() =>
  vi.fn<
    (appVersion: string, overrides?: Readonly<Record<string, string>>) => Record<string, string>
  >(),
)
const desktopShellEnvironmentReadyMock = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(async () => undefined),
)
const existingShellsMock = vi.hoisted(() =>
  vi.fn<
    (options: {
      readonly environment: Readonly<Record<string, string>>
    }) => readonly TerminalShellCandidate[]
  >(),
)
const integrationCleanupMock = vi.hoisted(() => vi.fn<() => Promise<void>>())
const assertNativeAdmissionMock = vi.hoisted(() => vi.fn<() => void>())
vi.mock('../../../desktop-native-admission', () => ({
  assertDesktopNativeAdmission: assertNativeAdmissionMock,
}))
const readProcessMetadataMock = vi.hoisted(() =>
  vi.fn<(...args: readonly unknown[]) => Promise<unknown>>(),
)
const prepareTerminalShellLaunchMock = vi.hoisted(() =>
  vi.fn<
    (
      candidate: TerminalShellCandidate,
      environment: Readonly<Record<string, string>>,
      readinessNonce: string,
    ) => Promise<{
      readonly args: readonly string[]
      readonly environment: Record<string, string>
      readonly integrated: boolean
      readonly cleanup: () => Promise<void>
    }>
  >(),
)
export const ptyExitListeners: ((event: { readonly exitCode: number }) => void)[] = []

vi.mock('../../../env', () => ({
  getInteractiveTerminalEnv: getInteractiveTerminalEnvMock,
  logLevel: 'error',
}))
vi.mock('../../../desktop-shell-environment-process', () => ({
  desktopShellEnvironmentReady: desktopShellEnvironmentReadyMock,
}))

vi.mock('../terminal-shell', () => ({
  existingShells: existingShellsMock,
}))

vi.mock('../terminal-process-probes', () => ({
  readProcessMetadata: readProcessMetadataMock,
}))

vi.mock('../terminal-shell-integration', () => ({
  prepareTerminalShellLaunch: prepareTerminalShellLaunchMock,
}))

export const ZSH_CANDIDATE = {
  command: '/bin/zsh',
  args: ['-l', '-i'],
  label: 'zsh',
} satisfies TerminalShellCandidate
export const BASH_CANDIDATE = {
  command: '/bin/bash',
  args: ['--login', '-i'],
  label: 'bash',
} satisfies TerminalShellCandidate
export const SPAWN_REQUEST = {
  cwd: '/tmp/repo',
  cols: 100,
  rows: 28,
  env: {},
  readinessNonce: 'runner-generation-nonce',
} satisfies PtySpawnRequest

export function resetPtyRunnerHarness() {
  assertNativeAdmissionMock.mockReset()
  spawnMock.mockReset()
  getInteractiveTerminalEnvMock.mockReset()
  desktopShellEnvironmentReadyMock.mockReset().mockResolvedValue()
  existingShellsMock.mockReset()
  integrationCleanupMock.mockReset().mockResolvedValue()
  readProcessMetadataMock.mockReset().mockResolvedValue({
    pid: 4321,
    startedAt: 'Fri Sep 4 22:18:37 2026',
    tty: null,
  })
  prepareTerminalShellLaunchMock.mockReset()
  ptyExitListeners.length = 0
  prepareTerminalShellLaunchMock.mockImplementation(
    async (candidate, environment, _readinessNonce) => ({
      args: candidate.args,
      environment: { ...environment },
      integrated: true,
      cleanup: integrationCleanupMock,
    }),
  )
  getInteractiveTerminalEnvMock.mockReturnValue({
    PATH: '/usr/bin:/bin',
    TERM: 'xterm-256color',
    TERM_PROGRAM: 'OpenWaggle',
  })
  existingShellsMock.mockReturnValue([ZSH_CANDIDATE, BASH_CANDIDATE])
}

export function fakePty(
  socket?: { readonly pause: () => void; readonly resume: () => void },
  privatePtyValue: unknown = '/dev/ttys123',
) {
  const pty = fromPartial<Pty>({
    pid: 4321,
    onData: () => {},
    onExit: (listener: (event: { readonly exitCode: number }) => void) => {
      ptyExitListeners.push(listener)
      return { dispose: () => undefined }
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
  })
  if (socket !== undefined) Object.assign(pty, { _socket: socket })
  if (privatePtyValue !== null) Object.assign(pty, { _pty: privatePtyValue })
  Object.assign(pty, { spawnProcessIdentity: 'darwin:123:456' })
  Object.assign(pty, { ttyIdentity: 'darwin:16:123' })
  Object.assign(pty, { fd: 42 })
  Object.assign(pty, { closeDescriptor: vi.fn() })
  Object.assign(pty, { waitForResourceDrain: () => new Promise<void>(() => {}) })
  return pty
}

export function makeRunner(
  native: object | null = {
    processInfos: () => [],
    signalProcess: () => 0,
    signalByTty: () => 0,
  },
) {
  const ptyModule = fromPartial<PtyModule>({ spawn: spawnMock })
  Object.assign(ptyModule, { processTable: async () => [] })
  Object.assign(ptyModule, { listeningPorts: async () => [] })
  if (native !== undefined) Object.assign(ptyModule, { native: native })
  return makePtyRunner({
    appVersion: '1.2.3-test',
    loadPty: async () => ptyModule,
  })
}

export {
  assertNativeAdmissionMock,
  desktopShellEnvironmentReadyMock,
  existingShellsMock,
  getInteractiveTerminalEnvMock,
  integrationCleanupMock,
  prepareTerminalShellLaunchMock,
  readProcessMetadataMock,
  spawnMock,
}
