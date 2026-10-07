import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type FauxModelDefinition, fauxProvider } from '@earendil-works/pi-ai'
import { type ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { vi } from 'vitest'
import { buildSettingsSnapshot } from '../../../store/settings/snapshot'
import type { PiInteractionUiContextInput } from '../agent-kernel/interaction-ui-context'
import {
  installPiUserAppSettingsFallback,
  openWagglePiAppSettingsFrom,
} from '../openwaggle-pi-app-settings'
import type { OpenWagglePiAppSettings } from '../openwaggle-pi-settings-app-overlay'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import { createOpenWaggleAgentSessionFromServices } from '../pi-session-lifecycle'

const cleanups: Array<() => void> = []

/** Runs every cleanup registered by the sessions created since the last call. */
export function cleanupOpenWagglePiSessions() {
  while (cleanups.length > 0) cleanups.pop()?.()
}

function temporaryDirectory(label: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `openwaggle-${label}-`))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

/** Points Pi at an empty agent directory so the user's own Pi settings never leak into a test. */
function isolatePiAgentDirectory(globalSettings: object | undefined) {
  const agentDir = temporaryDirectory('pi-agent')
  if (globalSettings) {
    writeFileSync(path.join(agentDir, 'settings.json'), `${JSON.stringify(globalSettings)}\n`)
  }
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  cleanups.push(() => vi.unstubAllEnvs())
  return agentDir
}

function resolvedAppSettings(stored: Readonly<Record<string, unknown>> | undefined) {
  if (!stored) return undefined
  const removeFallback = installPiUserAppSettingsFallback()
  try {
    return openWagglePiAppSettingsFrom(buildSettingsSnapshot(stored).settings)
  } finally {
    removeFallback()
  }
}

export interface OpenWagglePiSessionOptions {
  readonly extensionFactories?: readonly ExtensionFactory[]
  readonly appSettings?: OpenWagglePiAppSettings
  /**
   * The user's stored OpenWaggle Settings, by key. The app settings are then resolved the way the
   * Host resolves them, falling back to the user's Pi settings for anything not chosen.
   */
  readonly openWaggleSettings?: Readonly<Record<string, unknown>>
  /** Contents of the user's global Pi `settings.json`. */
  readonly piGlobalSettings?: object
  readonly authorizationMode?: AgentAuthorizationMode
  readonly models?: readonly FauxModelDefinition[]
  readonly onEvent?: (event: AgentTransportEvent) => void
  /** Write the session to a Pi session file, as a Run does, instead of keeping it in memory. */
  readonly persistSessionFile?: boolean
  /** Prompt cache lifetime, in seconds, of every faux model, so Pi can keep its cache warm. */
  readonly promptCacheSeconds?: number
  /** The model the Session selects, such as a virtual model; the first faux model by default. */
  readonly selectedModel?: { readonly provider: string; readonly id: string }
}

/**
 * A real Pi session built the way OpenWaggle builds one for a Run: OpenWaggle's runtime services,
 * settings and resource loader, an offline faux provider, and OpenWaggle's UI context.
 */
export async function createOpenWagglePiSession(options: OpenWagglePiSessionOptions = {}) {
  const agentDir = isolatePiAgentDirectory(options.piGlobalSettings)
  const projectPath = temporaryDirectory('pi-project')
  const faux = fauxProvider({
    provider: 'test-provider',
    models: [
      ...(options.models ?? [{ id: 'test-model', contextWindow: 100_000, maxTokens: 10_000 }]),
    ],
  })
  const appSettings = options.appSettings ?? resolvedAppSettings(options.openWaggleSettings)
  const services = await createPiRuntimeServices(projectPath, {
    ...(options.extensionFactories ? { extensionFactories: options.extensionFactories } : {}),
    ...(appSettings ? { appSettings } : {}),
  })
  if (options.promptCacheSeconds !== undefined) {
    for (const model of faux.models) model.promptCache = { short: options.promptCacheSeconds }
  }
  services.modelRuntime.registerNativeProvider(faux.provider)
  await services.modelRuntime.setRuntimeApiKey(faux.provider.id, 'test-key')
  const events: AgentTransportEvent[] = []
  const openWaggleUi: PiInteractionUiContextInput = {
    sessionId: SessionId('openwaggle-test-session'),
    runId: 'openwaggle-test-run',
    resolveAuthorizationMode: async () => options.authorizationMode ?? 'yolo',
    authorizationProjectPath: null,
    signal: new AbortController().signal,
    onEvent: (event) => {
      events.push(event)
      options.onEvent?.(event)
    },
  }
  const selected = options.selectedModel
    ? services.modelRuntime.getModel(options.selectedModel.provider, options.selectedModel.id)
    : faux.getModel()
  if (!selected) throw new Error('The selected test model is not in the catalog')
  const { session } = await createOpenWaggleAgentSessionFromServices({
    services,
    model: selected,
    sessionManager: options.persistSessionFile
      ? SessionManager.create(projectPath, temporaryDirectory('pi-sessions'))
      : SessionManager.inMemory(projectPath),
    openWaggleUi,
  })
  cleanups.push(() => session.dispose())
  return { session, services, faux, model: faux.getModel(), events, projectPath, agentDir }
}
