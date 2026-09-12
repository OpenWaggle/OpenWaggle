import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { vi } from 'vitest'
import { makePtyRunner, type PtySpawnRequest } from '../terminal-pty-runner'
import type { TerminalShellCandidate } from '../terminal-shell'

type PtySpawnOptions = NonNullable<Parameters<typeof NodePtyModule.spawn>[2]>

const spawnMock = vi.hoisted(() =>
  vi.fn<(file: string, args: string[], options: PtySpawnOptions) => NodePtyModule.IPty>(),
)
const getInteractiveTerminalEnvMock = vi.hoisted(() =>
  vi.fn<
    (appVersion: string, overrides?: Readonly<Record<string, string>>) => Record<string, string>
  >(),
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
export const ptyExitListeners: Array<(event: { readonly exitCode: number }) => void> = []

vi.mock('../../../env', () => ({
  getInteractiveTerminalEnv: getInteractiveTerminalEnvMock,
  logLevel: 'error',
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
  privatePtyValue: unknown | null = '/dev/ttys123',
) {
  const pty = fromPartial<NodePtyModule.IPty>({
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
  if (socket !== undefined) Reflect.set(pty, '_socket', socket)
  if (privatePtyValue !== null) Reflect.set(pty, '_pty', privatePtyValue)
  Reflect.set(pty, 'spawnProcessIdentity', 'darwin:123:456')
  Reflect.set(pty, 'ttyIdentity', 'darwin:16:123')
  Reflect.set(pty, 'fd', 42)
  Reflect.set(pty, 'closeDescriptor', vi.fn())
  Reflect.set(pty, 'waitForResourceDrain', () => new Promise<void>(() => {}))
  return pty
}

export function makeRunner(
  native: object | null = {
    processInfos: () => [],
    signalProcess: () => 0,
    signalByTty: () => 0,
  },
) {
  const ptyModule = fromPartial<typeof NodePtyModule>({ spawn: spawnMock })
  Reflect.set(ptyModule, 'processTable', async () => [])
  Reflect.set(ptyModule, 'listeningPorts', async () => [])
  if (native !== undefined) Reflect.set(ptyModule, 'native', native)
  return makePtyRunner({
    appVersion: '1.2.3-test',
    loadPty: async () => ptyModule,
  })
}

export {
  assertNativeAdmissionMock,
  existingShellsMock,
  getInteractiveTerminalEnvMock,
  integrationCleanupMock,
  prepareTerminalShellLaunchMock,
  readProcessMetadataMock,
  spawnMock,
}
