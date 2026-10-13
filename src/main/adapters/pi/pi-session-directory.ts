import { homedir } from 'node:os'
import path from 'node:path'
import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent'
import { getEnvWithOverrides } from '../../env'

const HOME_PREFIX = /^~(?=$|[/\\])/

function expandHome(directory: string) {
  return directory.replace(HOME_PREFIX, () => homedir())
}

/** Pi's session directory override, read when it is needed, as Pi reads it. */
function piSessionDirectoryFromEnvironment() {
  return getEnvWithOverrides({}).PI_CODING_AGENT_SESSION_DIR?.trim() || undefined
}

/**
 * The directory Pi keeps `cwd`'s sessions in when it is not Pi's default, resolved the way the
 * `pi` CLI resolves it: `PI_CODING_AGENT_SESSION_DIR`, then the `sessionDir` setting in the
 * project's `.pi/settings.json` or the global `settings.json`. Undefined means Pi's default, one
 * folder per working directory under `<agent dir>/sessions`. A custom directory holds the files
 * directly, for every working directory, so a session there is matched by its header's `cwd`.
 * A relative setting is taken from `cwd`, where the CLI is normally started.
 */
export function resolvePiSessionDirectory(cwd: string): string | undefined {
  const configured = piSessionDirectoryFromEnvironment() ?? readSessionDirSetting(cwd)
  if (!configured) return undefined
  return path.resolve(cwd, expandHome(configured))
}

function readSessionDirSetting(cwd: string) {
  try {
    return SettingsManager.create(cwd, getAgentDir()).getSessionDir() || undefined
  } catch {
    // Pi itself starts with its defaults when a settings file cannot be read.
    return undefined
  }
}
