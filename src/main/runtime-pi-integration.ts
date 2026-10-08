/**
 * Wires the Pi adapter's settings and prompt cache warming into the Host: the Pi adapter imports
 * no store and subscribes to nothing on its own, and the Host reaches warming only through the
 * PromptCacheWarming port.
 */
import { idleCacheWarming } from './adapters/pi/agent-kernel/pi-idle-cache-warming'
import {
  currentOpenWagglePiAppSettings,
  readPiUserAppSettingsFile,
  setOpenWagglePiAppSettingsSource,
} from './adapters/pi/openwaggle-pi-app-settings'
import { installPromptCacheWarming, promptCacheWarming } from './application/prompt-cache-warming'
import { onSessionRemoved } from './application/session-removal-hooks'
import { onAuthoritativeSettingsChange } from './store/authoritative-settings'
import { configurePiUserRuntimeSettingsReader } from './store/settings/pi-runtime-settings'

let installed: (() => void) | undefined

/** Idempotent. Returns the function that undoes it, for tests. */
export function installPiRuntimeIntegration() {
  if (installed) return installed
  // Settings OpenWaggle shares with Pi fall back to the user's own Pi values until chosen here.
  const removeFallback = configurePiUserRuntimeSettingsReader(readPiUserAppSettingsFile)
  const removeWarming = installPromptCacheWarming(idleCacheWarming)
  // Archiving or deleting a Session, Hive cleanup of a Worker included, ends its cache warming.
  // Removal hooks run before the Pi file is archived or deleted, so no warming session writes it.
  const removeHook = onSessionRemoved(async (sessionId) => {
    promptCacheWarming().closeSession(sessionId)
  })
  const unsubscribe = onAuthoritativeSettingsChange((settings) => {
    setOpenWagglePiAppSettingsSource(settings)
    // A Pi session reads `cacheWarming` once, when it is built, so the Host applies a change.
    if (settings) promptCacheWarming().applyMode(currentOpenWagglePiAppSettings().cacheWarming)
  })
  installed = () => {
    unsubscribe()
    removeHook()
    removeWarming()
    removeFallback()
    setOpenWagglePiAppSettingsSource(undefined)
    installed = undefined
  }
  return installed
}
