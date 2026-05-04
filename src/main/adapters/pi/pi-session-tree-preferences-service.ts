import type { SessionTreeFilterMode } from '@shared/types/session'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { SessionTreePreferencesService } from '../../ports/session-tree-preferences-service'
import { createOpenWagglePiSettingsManager } from './openwaggle-pi-settings-storage'

const DEFAULT_PROJECT_PATH = process.cwd()

function getSettingsManager(projectPath?: string | null) {
  return createOpenWagglePiSettingsManager(projectPath ?? DEFAULT_PROJECT_PATH)
}

function readTreeFilterMode(projectPath?: string | null): SessionTreeFilterMode {
  return getSettingsManager(projectPath).getTreeFilterMode()
}

function readBranchSummarySkipPrompt(projectPath?: string | null): boolean {
  return getSettingsManager(projectPath).getBranchSummarySkipPrompt()
}

async function writeTreeFilterMode(
  mode: SessionTreeFilterMode,
  projectPath?: string | null,
): Promise<void> {
  const settingsManager = getSettingsManager(projectPath)
  settingsManager.setTreeFilterMode(mode)
  await settingsManager.flush()
}

export const PiSessionTreePreferencesLive = Layer.succeed(SessionTreePreferencesService, {
  getTreeFilterMode: (projectPath) =>
    Effect.try({
      try: () => readTreeFilterMode(projectPath),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  setTreeFilterMode: (mode, projectPath) =>
    Effect.tryPromise({
      try: () => writeTreeFilterMode(mode, projectPath),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  getBranchSummarySkipPrompt: (projectPath) =>
    Effect.try({
      try: () => readBranchSummarySkipPrompt(projectPath),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
})
