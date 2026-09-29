import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import { isUpdateChannel, type UpdateChannel } from '@shared/types/update-channel'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { invokeConfiguredHostUi } from '../application/gui-session-command-router'
import { listHostUiActiveActivities } from '../application/host-ui-agent-operation'
import { getAllBrowserWindows, showMessageBox } from '../desktop-ui'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'
import { createUpdateRestartController, type UpdateRestartChoice } from '../update-restart'
import {
  checkForUpdates,
  getUpdateStatus,
  installUpdate,
  setUpdateWaitingForRuns,
} from '../updater'
import { interruptSessionRun } from './agent-handler'
import { typedHandle } from './typed-ipc'

const logger = createLogger('update-restart')
const UPDATE_RESTART_POLL_INTERVAL_MS = 3_000
const UPDATE_RESTART_INTERRUPT_SETTLE_TIMEOUT_MS = 30_000
const RESTART_CHOICES: readonly UpdateRestartChoice[] = ['when-idle', 'now', 'cancel']
const CANCEL_CHOICE_INDEX = 2
const activeActivitiesSchema = Schema.Array(
  Schema.Struct({
    activity: Schema.Literal('agent-run', 'compaction'),
    sessionId: Schema.String,
  }),
)

function parseUpdateChannel(value: unknown): UpdateChannel | undefined {
  if (value === undefined || isUpdateChannel(value)) return value
  throw new Error('Invalid update channel')
}

/** Active runs and compactions across every Session the Session Host owns. */
async function listActiveActivities() {
  const remote = await invokeConfiguredHostUi('agent:list-active-runs', [])
  const activities = remote.handled
    ? remote.result
    : await runAppEffect(listHostUiActiveActivities())
  return decodeUnknownOrThrow(activeActivitiesSchema, activities)
}

async function interruptActiveRuns() {
  const activities = await listActiveActivities()
  const sessionIds = new Set(
    activities.filter((activity) => activity.activity === 'agent-run').map((a) => a.sessionId),
  )
  await Promise.all(
    [...sessionIds].map((sessionId) => runAppEffect(interruptSessionRun(SessionId(sessionId)))),
  )
}

async function chooseRestart(activeRuns: number): Promise<UpdateRestartChoice> {
  const runs = activeRuns === 1 ? '1 agent run is' : `${activeRuns} agent runs are`
  const { response } = await showMessageBox(getAllBrowserWindows()[0] ?? null, {
    type: 'question',
    buttons: ['Restart when idle', 'Restart now', 'Cancel'],
    defaultId: 0,
    cancelId: CANCEL_CHOICE_INDEX,
    message: `${runs} still working.`,
    detail:
      'Restarting now will stop them. Restart when idle installs the update as soon as no agent run is active.',
  })
  return RESTART_CHOICES[response] ?? 'cancel'
}

const updateRestart = createUpdateRestartController({
  countActiveRuns: async () => (await listActiveActivities()).length,
  chooseRestart,
  interruptActiveRuns,
  hasInstallableUpdate: () => getUpdateStatus().type === 'downloaded',
  reportWaiting: setUpdateWaitingForRuns,
  install: installUpdate,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs: UPDATE_RESTART_POLL_INTERVAL_MS,
  interruptSettleTimeoutMs: UPDATE_RESTART_INTERRUPT_SETTLE_TIMEOUT_MS,
  logError: (message, error) => {
    logger.error(message, { error: error instanceof Error ? error.message : String(error) })
  },
})

export function registerUpdaterHandlers(): void {
  typedHandle('updater:check', (_event, rawChannel?: unknown) =>
    Effect.sync(() => {
      checkForUpdates(parseUpdateChannel(rawChannel))
    }),
  )

  typedHandle('updater:install', () => Effect.promise(() => updateRestart.requestRestart()))

  typedHandle('updater:install-now', () => Effect.promise(() => updateRestart.restartNow()))

  typedHandle('updater:get-status', () => Effect.sync(() => getUpdateStatus()))

  typedHandle('app:get-version', () => Effect.sync(() => app.getVersion()))
}
