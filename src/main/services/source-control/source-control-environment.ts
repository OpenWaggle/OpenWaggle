import { homedir } from 'node:os'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { SourceControlProviderId } from '@shared/types/change-request'
import { SOURCE_CONTROL_TOKEN_VARIABLES } from '@shared/types/source-control'
import { getSourceControlCliEnv, readEnvironmentVariables } from '../../env'

const CLI_CONFIG_VARIABLES = [
  'GH_CONFIG_DIR',
  'GLAB_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'APPDATA',
] as const

/** Provider token variables that are set, which OpenWaggle strips and never uses (ADR 0048). */
export function ignoredSourceControlTokenVariables(provider: SourceControlProviderId): string[] {
  const values = readEnvironmentVariables(SOURCE_CONTROL_TOKEN_VARIABLES[provider])
  return SOURCE_CONTROL_TOKEN_VARIABLES[provider].filter((name) => Boolean(values[name]))
}

/** gh reads `GH_TOKEN` for github.com and GitHub Enterprise Cloud (`*.ghe.com`) hosts. */
function usesGithubDotComToken(host: string) {
  const key = host.toLowerCase()
  return key === 'github.com' || key.endsWith('.ghe.com')
}

/**
 * The source-control CLI environment authenticated as one exact Provider account, using a token
 * read from that CLI's own keyring for a host already validated against the Git remote.
 */
export function getSourceControlCliEnvForAccountToken(
  provider: SourceControlProviderId,
  host: string,
  token: string,
): Record<string, string | undefined> {
  const env = getSourceControlCliEnv()
  const variable = match(provider)
    .with('gitlab', () => 'GITLAB_TOKEN')
    .with('github', () => (usesGithubDotComToken(host) ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN'))
    .exhaustive()
  env[variable] = token
  return env
}

/** Directories the gh and glab CLIs read their host lists from, in precedence order. */
export function getSourceControlCliConfigDirectories(platform: NodeJS.Platform = process.platform) {
  const home = homedir()
  const values = readEnvironmentVariables(CLI_CONFIG_VARIABLES)
  const xdg = values.XDG_CONFIG_HOME
  const appData = platform === 'win32' ? values.APPDATA : undefined
  const gh = values.GH_CONFIG_DIR
    ? [values.GH_CONFIG_DIR]
    : [
        ...(xdg ? [path.join(xdg, 'gh')] : []),
        ...(appData ? [path.join(appData, 'GitHub CLI')] : []),
        path.join(home, '.config', 'gh'),
      ]
  const glab = values.GLAB_CONFIG_DIR
    ? [values.GLAB_CONFIG_DIR]
    : [
        ...(xdg ? [path.join(xdg, 'glab-cli')] : []),
        ...(platform === 'darwin'
          ? [path.join(home, 'Library', 'Application Support', 'glab-cli')]
          : []),
        ...(appData ? [path.join(appData, 'glab-cli')] : []),
        path.join(home, '.config', 'glab-cli'),
      ]
  return { gh, glab }
}
