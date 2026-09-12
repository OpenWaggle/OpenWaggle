import { randomUUID } from 'node:crypto'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { desktopServiceCommandSchema } from '@shared/schemas/desktop-service'
import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopCommandEnvelope,
  type DesktopCompletion,
  type DesktopMutationScope,
  type DesktopServiceCommand,
  type DesktopServiceResult,
} from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import { desktopCommandTouchesFence } from '../application/desktop-service-policy'
import type { BrowserPreviewAutomationServiceShape } from '../ports/browser-preview-automation-service'
import type { TerminalServiceShape } from '../ports/terminal-service'
import { executeDesktopBrowserCommand } from './desktop-browser-executor'
import { executeDesktopTerminalCommand } from './desktop-terminal-executor'
import { makeGuiDesktopMutationFences } from './gui-desktop-mutation-fences'

/** Retain this executor for the GUI process lifetime, including Host reconnects. */
export function makeGuiDesktopServiceExecutor(services: {
  readonly terminal: TerminalServiceShape
  readonly browser: BrowserPreviewAutomationServiceShape
  readonly acquireBrowserMutationFence: (scope: DesktopMutationScope) => Promise<() => void>
  readonly deleteBrowserOwner: (ownerKey: string) => Promise<void>
}) {
  const running = new Map<
    string,
    {
      readonly controller: AbortController
      readonly command: DesktopServiceCommand
      readonly settled: Promise<void>
    }
  >()
  const finished = new Set<string>()
  const fences = makeGuiDesktopMutationFences({
    terminal: services.terminal,
    acquireBrowserMutationFence: services.acquireBrowserMutationFence,
    drainBrowser: async (record) => {
      await Promise.all(
        [...running.values()]
          .filter((entry) => desktopCommandTouchesFence(entry.command, record))
          .map((entry) => entry.settled),
      )
    },
  })

  function dispatch(command: DesktopServiceCommand): Effect.Effect<DesktopServiceResult, Error> {
    if (command.service === 'terminal')
      return executeDesktopTerminalCommand(services.terminal, command)
    if (command.service === 'fence') {
      return Effect.tryPromise({
        try: () => {
          return fences.acknowledge(command.record)
        },
        catch: () => new Error('Could not acquire the desktop mutation fence.'),
      }).pipe(Effect.as({ service: 'fence' as const, operation: 'acquire' as const, value: null }))
    }
    if (command.operation === 'deleteOwner') {
      return Effect.tryPromise({
        try: () => services.deleteBrowserOwner(command.ownerKey),
        catch: () => new Error('Could not dispose this Session browser previews.'),
      }).pipe(
        Effect.as({ service: 'browser' as const, operation: 'deleteOwner' as const, value: null }),
      )
    }
    return executeDesktopBrowserCommand(services.browser, command)
  }

  async function execute(
    envelope: DesktopCommandEnvelope,
    leaseId: string,
  ): Promise<DesktopCompletion> {
    const failure = (message: string): DesktopCompletion => ({
      commandId: envelope.commandId,
      outcome: 'failure',
      message,
    })
    if (envelope.leaseId !== leaseId || envelope.deadline <= Date.now())
      return failure('The desktop command lease or deadline is stale.')
    if (running.has(envelope.commandId) || finished.has(envelope.commandId))
      return failure('The desktop command was already dispatched.')
    if (running.size >= DESKTOP_SERVICE_LIMITS.pendingCommands)
      return failure('The desktop executor is full.')
    let command: DesktopServiceCommand
    try {
      command = decodeUnknownExactOrThrow(desktopServiceCommandSchema, envelope.command)
    } catch {
      return failure('The desktop command did not match the supported schema.')
    }
    if (fences.blocks(command))
      return failure('This Session or Workspace has an active desktop mutation fence.')
    const controller = new AbortController()
    const settled = Promise.withResolvers<void>()
    running.set(envelope.commandId, { controller, command, settled: settled.promise })
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, envelope.deadline - Date.now()),
    )
    timeout.unref?.()
    try {
      const result = await Effect.runPromise(dispatch(command), { signal: controller.signal })
      return { commandId: envelope.commandId, outcome: 'success', result }
    } catch {
      return {
        commandId: envelope.commandId,
        outcome: 'failure',
        uncertain: true,
        message:
          'The desktop operation failed or was interrupted. Inspect the desktop before retrying.',
      }
    } finally {
      clearTimeout(timeout)
      running.delete(envelope.commandId)
      settled.resolve()
      finished.add(envelope.commandId)
      if (finished.size > DESKTOP_SERVICE_LIMITS.pendingCommands) {
        const oldest = finished.values().next().value
        if (oldest !== undefined) finished.delete(oldest)
      }
    }
  }

  return {
    guiInstanceId: randomUUID(),
    isIdle: () => running.size === 0,
    execute,
    reconcile: fences.reconcile,
    hasActiveFences: fences.hasActive,
    cancel: (commandId: string) => running.get(commandId)?.controller.abort(),
    cancelCommands: () => {
      for (const entry of running.values()) entry.controller.abort()
    },
  }
}

export type GuiDesktopServiceExecutor = ReturnType<typeof makeGuiDesktopServiceExecutor>
