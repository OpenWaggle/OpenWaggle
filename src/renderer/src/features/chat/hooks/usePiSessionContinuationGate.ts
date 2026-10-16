import { piSessionContinueCommand } from '@shared/pi-session-continuation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { usePreferencesStore } from '@/features/settings/state'
import { runSessionTerminalCommand, terminalOwnerContext } from '@/features/terminal'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { sessionTerminalShell } from '@/shared/lib/terminal-shell'
import {
  mayNeedPiSessionContinuationChoice,
  PiSessionContinuationHeld,
  rememberedPiSessionContinuation,
} from '../lib/pi-session-continuation'
import { useChatStore } from '../state'
import {
  type PiSessionContinuationAnswer,
  usePiSessionContinuationStore,
} from '../state/pi-session-continuation-store'

const logger = createRendererLogger('pi-session-continuation')

type Send = (payload: AgentSendPayload) => Promise<void> | false

interface UsePiSessionContinuationGateInput {
  readonly activeSessionId: SessionId | null
  readonly session: SessionDetail | null
  readonly send: Send
}

/**
 * The Session as its Pi file is now: the Host reads the file again before answering, so it knows
 * whether `pi` wrote to it since. The transcript shown follows, so what pi wrote appears too.
 */
async function readCurrentSession(cached: SessionDetail) {
  try {
    const session = await api.getSessionDetail(cached.id)
    if (!session) return cached
    const shown = useChatStore.getState().sessionById.get(cached.id)
    if (!shown || session.updatedAt >= shown.updatedAt)
      useChatStore.getState().upsertSession(session)
    return session
  } catch (cause) {
    logger.warn('Could not read the Session again before sending', { error: String(cause) })
    return cached
  }
}

/**
 * Opens the Session's terminal in the folder the Pi session ran in, with `pi --session <file>`
 * typed but not run, so the person checks it and presses Enter. Copies the command when no
 * terminal can open.
 */
function keepRunningInPi(session: SessionDetail, fallbackProjectPath: string | null) {
  const file = session.piSessionFile
  if (!file) return 'dismissed' as const
  const command = piSessionContinueCommand(file, sessionTerminalShell())
  const owner = terminalOwnerContext(session, fallbackProjectPath)
  const cwd = session.piSessionCwd ?? owner.defaultCwd
  const terminalId = cwd
    ? runSessionTerminalCommand({
        ownerKey: owner.ownerKey,
        cwd,
        command,
        title: 'pi',
        submit: false,
      })
    : null
  if (terminalId !== null) return 'kept-in-pi' as const
  api.copyToClipboard(command)
  return 'kept-in-pi-copied' as const
}

function sendNow(send: Send, payload: AgentSendPayload) {
  const result = send(payload)
  // The send gate refused it and said why; the message goes back to the composer.
  if (result === false) throw new PiSessionContinuationHeld('dismissed')
  return result
}

/**
 * Before the composer sends in a Session whose Pi file's latest prompt came from outside
 * OpenWaggle, such as the `pi` CLI, asks whether to continue it here or keep running it in pi
 * (ADR 0051), unless the person remembered a choice for the project. A held send rejects with
 * `PiSessionContinuationHeld`, which puts the message back in the composer.
 */
export function usePiSessionContinuationGate(input: UsePiSessionContinuationGateInput): Send {
  const rememberedByProject = usePreferencesStore(
    (state) => state.settings.piSessionContinuationByProject,
  )
  const openedProjectPath = usePreferencesStore((state) => state.settings.projectPath)
  const remember = usePreferencesStore((state) => state.setProjectPiSessionContinuation)
  const ask = usePiSessionContinuationStore((state) => state.ask)

  const rememberAnswer = (projectPath: string | null, answer: PiSessionContinuationAnswer) => {
    if (!answer.remember || !projectPath) return
    void remember(projectPath, answer.choice).catch((cause: unknown) => {
      logger.warn('Could not remember the Pi continuation choice', { error: String(cause) })
    })
  }

  const continueOrHold = async (session: SessionDetail, payload: AgentSendPayload) => {
    const current = await readCurrentSession(session)
    if (!current.piSessionLastPromptOutside) return sendNow(input.send, payload)
    const remembered = rememberedPiSessionContinuation(rememberedByProject, current.projectPath)
    const answer = remembered
      ? { choice: remembered, remember: false }
      : await ask({ sessionId: current.id, projectPath: current.projectPath })
    if (!answer) throw new PiSessionContinuationHeld('dismissed')
    rememberAnswer(current.projectPath, answer)
    if (answer.choice === 'openwaggle') return sendNow(input.send, payload)
    throw new PiSessionContinuationHeld(keepRunningInPi(current, openedProjectPath))
  }

  return (payload) => {
    const session = input.session
    if (
      !session ||
      session.id !== input.activeSessionId ||
      !mayNeedPiSessionContinuationChoice(session) ||
      rememberedPiSessionContinuation(rememberedByProject, session.projectPath) === 'openwaggle'
    ) {
      return input.send(payload)
    }
    return continueOrHold(session, payload)
  }
}
