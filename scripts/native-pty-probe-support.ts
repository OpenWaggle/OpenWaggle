import fs from 'node:fs/promises'
import { constants } from 'node:os'
import { isMatching, P } from '@diegogbrisa/ts-match'

export const PROBE_TIMEOUT_MS = 10_000
export const DESCENDANT_SETTLE_MS = 650
export const IDENTITY_PREFIX = 'OPENWAGGLE_PTY_IDENTITY:'
export const PROMPT_INPUT = 'openwaggle-native-probe-input\n'
export const PROMPT_OUTPUT = 'OPENWAGGLE_PTY_PROMPT_OK'

const INITIAL_COLUMNS = 80
const INITIAL_ROWS = 24
const RESIZED_COLUMNS = 81
const RESIZED_ROWS = 25
const DESCENDANT_SENTINEL_DELAY_MS = 450
const FINAL_PAYLOAD_BYTES = 256 * 1024
const FINAL_PREFIX = 'OPENWAGGLE_PTY_FINAL_START:'
const FINAL_SUFFIX = ':OPENWAGGLE_PTY_FINAL_END'
const FINAL_CHARACTER = '~'

export type Disposable = { readonly dispose: () => void }
export type ExitEvent = { readonly exitCode: number; readonly signal?: number }
export type PtyEvent<T> = (listener: (event: T) => void) => Disposable

export interface ProbedPty {
  readonly pid: number
  readonly onData: PtyEvent<string>
  readonly onExit: PtyEvent<ExitEvent>
  readonly onProcessTreeExit?: PtyEvent<ExitEvent>
  readonly closeDescriptor: () => void
  readonly waitForResourceDrain: () => Promise<void>
  readonly write: (data: string) => void
  readonly resize: (columns: number, rows: number) => void
}

export interface PtySpawner {
  readonly native?: unknown
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => unknown
}

export function signalOwnedPosixPty(nodePty: PtySpawner, pty: ProbedPty) {
  const native = nodePty.native
  if (native === null || typeof native !== 'object') throw new Error('Missing POSIX native API.')
  const signal: unknown = Reflect.get(native, 'signalByTty')
  if (typeof signal !== 'function') throw new Error('Missing POSIX PTY membership signal.')
  const result: unknown = Reflect.apply(signal, native, [
    Reflect.get(pty, 'fd'),
    Reflect.get(pty, 'ttyIdentity'),
    pty.pid,
    Reflect.get(pty, 'spawnProcessIdentity'),
    constants.signals.SIGHUP,
  ])
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
    throw new Error('POSIX PTY membership could not be safely signaled.')
  }
}

export interface Backend {
  readonly label: string
  readonly options: Readonly<Record<string, boolean>>
}

export interface PtyIdentity {
  readonly pid: number
  readonly descendantPid: number
  readonly stdinTty: boolean
  readonly stdoutTty: boolean
}

function hasFunctionProperties(value: object, propertyNames: readonly string[]) {
  return propertyNames.every(
    (propertyName) => propertyName in value && typeof Reflect.get(value, propertyName) === 'function',
  )
}

function isProbedPty(value: unknown): value is ProbedPty {
  if (typeof value !== 'object' || value === null) return false
  if (!('pid' in value) || typeof value.pid !== 'number') return false
  return (
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    hasFunctionProperties(value, [
      'onData',
      'onExit',
      'closeDescriptor',
      'waitForResourceDrain',
      'write',
      'resize',
    ])
  )
}

export function backends(platform: NodeJS.Platform): readonly Backend[] {
  if (platform !== 'win32') return [{ label: 'Unix PTY', options: {} }]
  return [
    { label: 'system ConPTY', options: { useConpty: true, useConptyDll: false } },
    { label: 'bundled ConPTY', options: { useConpty: true, useConptyDll: true } },
    { label: 'WinPTY', options: { useConpty: false } },
  ]
}

export function assertPatchedPty(
  value: unknown,
  backend: Backend,
  platform: NodeJS.Platform,
) {
  if (!isProbedPty(value)) {
    throw new Error(`${backend.label} did not expose the patched PTY lifecycle contract.`)
  }
  if (platform === 'win32' && typeof value.onProcessTreeExit !== 'function') {
    throw new Error(`${backend.label} did not expose onProcessTreeExit.`)
  }
  if (platform !== 'win32') {
    for (const property of ['spawnProcessIdentity', 'ttyIdentity']) {
      const identity: unknown = Reflect.get(value, property)
      if (typeof identity !== 'string' || identity.length === 0) {
        throw new Error(`${backend.label} did not expose ${property}.`)
      }
    }
    const fd: unknown = Reflect.get(value, 'fd')
    if (typeof fd !== 'number' || !Number.isSafeInteger(fd) || fd < 0) {
      throw new Error(`${backend.label} did not expose an active PTY master descriptor.`)
    }
  }
  return value
}

export function parseIdentity(output: string): PtyIdentity {
  const prefixIndex = output.indexOf(IDENTITY_PREFIX)
  const lineEnd = output.indexOf('\n', prefixIndex)
  if (prefixIndex === -1 || lineEnd === -1) throw new Error('PTY identity record was incomplete.')
  const serialized = output.slice(prefixIndex + IDENTITY_PREFIX.length, lineEnd).trim()
  const [pidText, descendantPidText, stdinTtyText, stdoutTtyText, ...extraFields] =
    serialized.split(',')
  const value: unknown = {
    pid: Number(pidText),
    descendantPid: Number(descendantPidText),
    stdinTty: stdinTtyText === '1',
    stdoutTty: stdoutTtyText === '1',
  }
  const positiveInteger = P.when(
    (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0,
  )
  if (
    extraFields.length > 0 ||
    !isMatching(
      { pid: positiveInteger, descendantPid: positiveInteger, stdinTty: true, stdoutTty: true },
      value,
    )
  ) {
    throw new Error(`PTY identity failed: ${serialized}`)
  }
  return value
}

export function assertExitEvent(label: string, event: ExitEvent) {
  if (!Number.isInteger(event.exitCode)) {
    throw new Error(`${label} emitted a non-integer exit code.`)
  }
}

export function assertTreeFirst(label: string, stages: readonly string[]) {
  const treeIndex = stages.indexOf('tree')
  const resourceIndex = stages.indexOf('resources')
  const publicIndex = stages.indexOf('public')
  if (treeIndex === -1 || resourceIndex <= treeIndex || publicIndex <= treeIndex) {
    throw new Error(`${label} lifecycle settled out of order: ${stages.join(' -> ')}.`)
  }
}

export function assertFinalPayload(label: string, output: string) {
  const start = output.indexOf(FINAL_PREFIX)
  const end = output.indexOf(FINAL_SUFFIX, start + FINAL_PREFIX.length)
  if (start === -1 || end === -1) throw new Error(`${label} dropped final output markers.`)
  const payload = output.slice(start + FINAL_PREFIX.length, end)
  if (payload.length !== FINAL_PAYLOAD_BYTES || payload.replaceAll(FINAL_CHARACTER, '') !== '') {
    throw new Error(`${label} corrupted final PTY output (${payload.length} bytes received).`)
  }
}

export function spawnOptions(backend: Backend) {
  return {
    ...backend.options,
    cols: INITIAL_COLUMNS,
    rows: INITIAL_ROWS,
    cwd: process.cwd(),
    env: process.env,
  }
}

export function resizePty(pty: ProbedPty) {
  pty.resize(RESIZED_COLUMNS, RESIZED_ROWS)
}

export function activeCloseScript(sentinelPath: string, startupPath: string) {
  const descendantScript = [
    "const fs=require('node:fs')",
    `setTimeout(()=>fs.writeFileSync(${JSON.stringify(sentinelPath)},'survived'),${DESCENDANT_SENTINEL_DELAY_MS})`,
  ].join(';')
  return [
    `require('node:fs').writeFileSync(${JSON.stringify(startupPath)},JSON.stringify({pid:process.pid,stdinTty:process.stdin.isTTY,stdoutTty:process.stdout.isTTY,runAsNode:process.env.ELECTRON_RUN_AS_NODE}))`,
    "const cp=require('node:child_process')",
    `const descendant=cp.spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:'ignore'})`,
    'descendant.unref()',
    `process.stdout.write(${JSON.stringify(IDENTITY_PREFIX)}+[process.pid,descendant.pid,process.stdin.isTTY===true?1:0,process.stdout.isTTY===true?1:0].join(',')+'\\n')`,
    `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(PROMPT_OUTPUT)}))`,
    'process.stdin.resume()',
    'setInterval(()=>{},60000)',
  ].join(';')
}

export function finalOutputScript() {
  return [
    "const fs=require('node:fs')",
    `const payload=Buffer.from(${JSON.stringify(FINAL_PREFIX)}+${JSON.stringify(FINAL_CHARACTER)}.repeat(${FINAL_PAYLOAD_BYTES})+${JSON.stringify(FINAL_SUFFIX)})`,
    'let offset=0',
    'while(offset<payload.length){offset+=fs.writeSync(1,payload,offset,payload.length-offset)}',
  ].join(';')
}

export async function sentinelExists(sentinelPath: string) {
  try {
    await fs.access(sentinelPath)
    return true
  } catch {
    return false
  }
}
