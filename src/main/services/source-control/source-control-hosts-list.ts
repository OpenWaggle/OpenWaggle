import type { SourceControlProviderId } from '@shared/types/change-request'
import {
  type SourceControlHostEntry,
  type SourceControlHostsOverview,
  sourceControlCliForProvider,
} from '@shared/types/source-control'
import { decideSourceControlHostProvider } from './host-provider-decision'
import {
  LIVE_SOURCE_CONTROL_CONFIGURATION_DEPS,
  type SourceControlConfigurationDeps,
} from './source-control-configuration'
import { providerChoices } from './source-control-remote-resolution'
import type {
  SourceControlSettings,
  SourceControlSettingsAccess,
} from './source-control-settings-access'

/** Hosts any project's approved declaration names; the Settings list shows them all. */
function approvedDeclarationHosts(
  records: SourceControlSettings['sourceControlProjectDeclarations'],
) {
  const hosts: Record<string, SourceControlProviderId> = {}
  for (const record of Object.values(records)) {
    Object.assign(hosts, record.approved)
  }
  return hosts
}

/** Every host OpenWaggle knows: CLI configs, the user's choices, and providers it detected. */
export async function listSourceControlHosts(
  access: SourceControlSettingsAccess,
  deps: Partial<SourceControlConfigurationDeps> = {},
): Promise<SourceControlHostsOverview> {
  const resolvedDeps = { ...LIVE_SOURCE_CONTROL_CONFIGURATION_DEPS, ...deps }
  const [settings, cliHosts, gh, glab] = await Promise.all([
    access.read(),
    resolvedDeps.readCliHosts(),
    resolvedDeps.isCliInstalled('gh'),
    resolvedDeps.isCliInstalled('glab'),
  ])
  const cliInstalled = { gh, glab }
  const approvedDeclarations = approvedDeclarationHosts(settings.sourceControlProjectDeclarations)
  const hosts = new Set([
    ...cliHosts.github.map((entry) => entry.host),
    ...cliHosts.gitlab.map((entry) => entry.host),
    ...Object.keys(settings.sourceControlHostProviders),
    ...Object.keys(settings.sourceControlDetectedHostProviders),
    ...Object.keys(approvedDeclarations),
  ])
  const userChoices = providerChoices(settings.sourceControlHostProviders)
  const entries = [...hosts].sort().map((host): SourceControlHostEntry => {
    if (settings.sourceControlHostProviders[host] === 'unsupported') {
      return {
        host,
        provider: null,
        source: 'user-choice',
        unsupported: true,
        cli: null,
        cliInstalled: false,
        accounts: [],
      }
    }
    const decision = decideSourceControlHostProvider(host, '', {
      userChoices,
      approvedDeclarations,
      cliHosts,
      credentialHelpers: {},
      detectedHosts: settings.sourceControlDetectedHostProviders,
    })
    const cli = decision ? sourceControlCliForProvider(decision.provider) : null
    return {
      host,
      provider: decision?.provider ?? null,
      source: decision?.source ?? null,
      unsupported: false,
      cli,
      cliInstalled: cli ? cliInstalled[cli] : false,
      accounts: decision
        ? ((decision.provider === 'github' ? cliHosts.github : cliHosts.gitlab).find(
            (entry) => entry.host === host,
          )?.accounts ?? [])
        : [],
    }
  })
  return { hosts: entries, cliInstalled }
}
