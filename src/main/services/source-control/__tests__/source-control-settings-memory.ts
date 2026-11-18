import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { SourceControlSettingsAccess } from '../source-control-settings-access'
import { createSerialSourceControlSettingsAccess } from '../source-control-settings-patch'

type Stored = Awaited<ReturnType<SourceControlSettingsAccess['read']>>

/** In-memory source-control Settings behind the real serial patch access. */
export function memoryAccess(initial: Partial<Stored> = {}) {
  let stored: Stored = {
    changeRequestOpenDestination: DEFAULT_SETTINGS.changeRequestOpenDestination,
    changeRequestOpenDestinationByProject: {},
    sourceControlHostProviders: {},
    sourceControlDetectedHostProviders: {},
    sourceControlRepositoryAccounts: {},
    sourceControlChangeRequestRepositories: {},
    sourceControlProjectDeclarations: {},
    ...initial,
  }
  const access = createSerialSourceControlSettingsAccess({
    read: async () => stored,
    update: async (partial) => {
      stored = { ...stored, ...partial }
    },
  })
  return { access, current: () => stored }
}

export const CLI_HOSTS = {
  github: [
    {
      host: 'github.com',
      accounts: [
        { login: 'jdoe', active: true },
        { login: 'jdoe_acme', active: false },
      ],
    },
  ],
  gitlab: [{ host: 'git.acme.io', sshHost: null, accounts: [{ login: 'jdoe', active: true }] }],
}
