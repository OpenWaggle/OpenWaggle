import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  activeCloseScript,
  assertExitEvent,
  assertFinalPayload,
  assertPatchedPty,
  assertTreeFirst,
  backends,
  type Backend,
  DESCENDANT_SETTLE_MS,
  type Disposable,
  type ExitEvent,
  finalOutputScript,
  IDENTITY_PREFIX,
  parseIdentity,
  PROBE_TIMEOUT_MS,
  PROMPT_INPUT,
  PROMPT_OUTPUT,
  type ProbedPty,
  type PtyEvent,
  type PtySpawner,
  resizePty,
  sentinelExists,
  signalOwnedPosixPty,
  spawnOptions,
} from './native-pty-probe-support'

function withTimeout<T>(label: string, operation: Promise<T>) {
  let timeout: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${PROBE_TIMEOUT_MS}ms.`)),
      PROBE_TIMEOUT_MS,
    )
  })
  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function observeOutput(pty: ProbedPty) {
  let output = ''
  const waiters = new Map<string, Set<() => void>>()
  const subscription = pty.onData((data) => {
    output += data
    for (const [marker, resolves] of waiters) {
      if (!output.includes(marker)) continue
      waiters.delete(marker)
      for (const resolve of resolves) resolve()
    }
  })
  return {
    dispose: () => subscription.dispose(),
    read: () => output,
    waitFor: (marker: string) => {
      if (output.includes(marker)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const resolves = waiters.get(marker) ?? new Set<() => void>()
        resolves.add(resolve)
        waiters.set(marker, resolves)
      })
    },
  }
}

function waitForEvent(event: PtyEvent<ExitEvent>, onEvent?: () => void) {
  return new Promise<ExitEvent>((resolve) => {
    const subscriptions = new Set<Disposable>()
    let completedSynchronously = false
    const subscription = event((value) => {
      onEvent?.()
      completedSynchronously = subscriptions.size === 0
      for (const disposable of subscriptions) disposable.dispose()
      resolve(value)
    })
    subscriptions.add(subscription)
    if (completedSynchronously) subscription.dispose()
  })
}

async function probeActiveClose(
  nodePty: PtySpawner,
  platform: NodeJS.Platform,
  executablePath: string,
  backend: Backend,
) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pty-probe-'))
  const sentinelPath = path.join(temporaryDirectory, 'descendant-survived')
  const pty = assertPatchedPty(
    nodePty.spawn(executablePath, ['-e', activeCloseScript(sentinelPath)], spawnOptions(backend)),
    backend,
    platform,
  )
  const output = observeOutput(pty)
  const stages: string[] = []
  const publicExit = waitForEvent(pty.onExit, () => stages.push('public'))
  const treeExit = pty.onProcessTreeExit
    ? waitForEvent(pty.onProcessTreeExit, () => stages.push('tree'))
    : undefined
  let descriptorClosed = false
  try {
    await withTimeout(`${backend.label} identity`, output.waitFor('\n'))
    const identity = parseIdentity(output.read())
    if (identity.pid !== pty.pid) {
      throw new Error(`${backend.label} reported PID ${pty.pid}, but spawned PID ${identity.pid}.`)
    }
    resizePty(pty)
    pty.write(PROMPT_INPUT)
    await withTimeout(`${backend.label} prompt delivery`, output.waitFor(PROMPT_OUTPUT))
    if (platform !== 'win32') signalOwnedPosixPty(nodePty, pty)
    pty.closeDescriptor()
    descriptorClosed = true
    pty.closeDescriptor()

    const treeEvent = treeExit
      ? await withTimeout(`${backend.label} process-tree exit`, treeExit)
      : undefined
    if (treeEvent && pty.onProcessTreeExit) {
      assertExitEvent(`${backend.label} process-tree exit`, treeEvent)
      const replay = await withTimeout(
        `${backend.label} process-tree replay`,
        waitForEvent(pty.onProcessTreeExit),
      )
      if (replay.exitCode !== treeEvent.exitCode) {
        throw new Error(`${backend.label} replayed a different process-tree exit code.`)
      }
    }
    await withTimeout(`${backend.label} resource drain`, pty.waitForResourceDrain())
    stages.push('resources')
    assertExitEvent(`${backend.label} public exit`, await withTimeout(`${backend.label} public exit`, publicExit))
    if (platform === 'win32') assertTreeFirst(backend.label, stages)
    await wait(DESCENDANT_SETTLE_MS)
    if (await sentinelExists(sentinelPath)) {
      throw new Error(`${backend.label} left descendant ${identity.descendantPid} alive after close.`)
    }
  } finally {
    output.dispose()
    if (!descriptorClosed) pty.closeDescriptor()
    await fs.rm(temporaryDirectory, { force: true, recursive: true })
  }
}

async function probeNaturalFinalOutput(
  nodePty: PtySpawner,
  platform: NodeJS.Platform,
  executablePath: string,
  backend: Backend,
) {
  const pty = assertPatchedPty(
    nodePty.spawn(executablePath, ['-e', finalOutputScript()], spawnOptions(backend)),
    backend,
    platform,
  )
  const output = observeOutput(pty)
  const stages: string[] = []
  const publicExit = waitForEvent(pty.onExit, () => stages.push('public'))
  const treeExit = pty.onProcessTreeExit
    ? waitForEvent(pty.onProcessTreeExit, () => stages.push('tree'))
    : undefined
  try {
    const treeEvent = treeExit
      ? await withTimeout(`${backend.label} natural process-tree exit`, treeExit)
      : undefined
    if (treeEvent) assertExitEvent(`${backend.label} natural process-tree exit`, treeEvent)
    await withTimeout(`${backend.label} natural resource drain`, pty.waitForResourceDrain())
    stages.push('resources')
    const exitEvent = await withTimeout(`${backend.label} natural public exit`, publicExit)
    assertExitEvent(`${backend.label} natural public exit`, exitEvent)
    if (exitEvent.exitCode !== 0) {
      throw new Error(`${backend.label} final-output process exited with ${exitEvent.exitCode}.`)
    }
    if (platform === 'win32') assertTreeFirst(`${backend.label} natural exit`, stages)
    assertFinalPayload(backend.label, output.read())
    pty.closeDescriptor()
    pty.closeDescriptor()
  } finally {
    output.dispose()
  }
}

export async function probeNodePtyLifecycle(
  nodePty: PtySpawner,
  platform: NodeJS.Platform,
  executablePath: string,
) {
  for (const backend of backends(platform)) {
    await probeActiveClose(nodePty, platform, executablePath, backend)
    await probeNaturalFinalOutput(nodePty, platform, executablePath, backend)
  }
}
