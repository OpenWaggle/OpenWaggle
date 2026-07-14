import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS,
  createBootstrapInterruptionCoordinator,
  type BootstrapSignalProcess,
} from '../package-release-bootstrap-adapters'
import {
  runPackageReleaseBootstrap,
  type BootstrapDependencies,
} from '../package-release-bootstrap'
import {
  commandKey,
  createDependencies,
  PACKAGE_NAMES,
  successful,
  successfulFirstPackageTransaction,
} from './package-release-bootstrap-test-helpers'

afterEach(() => vi.useRealTimers())

describe('package release bootstrap signal recovery', () => {
  it('reasserts MFA and cleans temp state before restoring a signal after publish', async () => {
    vi.useFakeTimers()
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    overrides.set('npm publish --tag bootstrap --access public --ignore-scripts', {
      exitCode: 1,
      stderr: 'publish child interrupted after registry upload',
      stdout: '',
    })
    const events: string[] = []
    const listeners = new Map<string, () => void>()
    const signalProcess: BootstrapSignalProcess = {
      off: (signal, listener) => {
        if (listeners.get(signal) === listener) listeners.delete(signal)
      },
      on: (signal, listener) => {
        listeners.set(signal, listener)
      },
      pid: 42,
      scheduleFallback: (listener) => {
        const timeout = setTimeout(listener, BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)
        return () => clearTimeout(timeout)
      },
      sendSignal: (_pid, signal) => events.push(`signal:${signal}`),
    }
    const interruptions = createBootstrapInterruptionCoordinator(signalProcess)
    const base = createDependencies(overrides)
    let signalSent = false
    const dependencies: BootstrapDependencies = {
      ...base.dependencies,
      commands: {
        run: async (request) => {
          const result = await base.dependencies.commands.run(request)
          if (request.mutates === true) events.push(commandKey(request))
          if (request.command === 'npm' && request.args[0] === 'publish' && !signalSent) {
            signalSent = true
            listeners.get('SIGINT')?.()
          }
          return result
        },
      },
      files: {
        ...base.dependencies.files,
        removeDirectory: async (directory) => {
          await base.dependencies.files.removeDirectory(directory)
          events.push('temp-cleaned')
        },
      },
      interruptions,
    }

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(events).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${packageName}`,
      'temp-cleaned',
      `npm access set mfa=publish ${packageName}`,
      'signal:SIGINT',
    ])
    expect(base.requests.filter((request) => request.mutates).map(commandKey)).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${packageName}`,
      `npm access set mfa=publish ${packageName}`,
    ])
  })

  it('reports both the original failure and failed MFA compensation', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    overrides.set('npm publish --tag bootstrap --access public --ignore-scripts', {
      exitCode: 1,
      stderr: 'ambiguous publish failure',
      stdout: '',
    })
    overrides.set(`npm access set mfa=publish ${packageName}`, {
      exitCode: 1,
      stderr: 'MFA recovery failure',
      stdout: '',
    })
    const { dependencies } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.blockers).toEqual([
      expect.stringContaining('ambiguous publish failure'),
    ])
    expect(result.blockers[0]).toContain('Restrictive MFA recovery also failed')
  })
})
