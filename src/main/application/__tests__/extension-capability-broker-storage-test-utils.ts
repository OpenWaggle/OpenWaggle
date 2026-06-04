import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { JsonValue } from '@shared/types/json'
import { BROKER_EXTENSION_ID } from './extension-capability-broker-test-utils'
import { makePackage, PROJECT_PATH } from './extension-contribution-registry-test-utils'

export const STORAGE_CONTRIBUTION_ID = {
  GET: 'storage.get',
  SET: 'storage.set',
  DELETE: 'storage.delete',
  LIST: 'storage.list',
  SETTINGS: 'storage.settings',
} as const

const STORAGE_METHODS = [
  OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
  OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
  OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
  OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
] as const

export function makeStorageBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        methods: [...STORAGE_METHODS],
        scopes: ['app', 'project', 'session', 'branch'],
      },
    ],
    contributions: {
      commands: [
        {
          id: STORAGE_CONTRIBUTION_ID.GET,
          title: 'Get Storage',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        },
        {
          id: STORAGE_CONTRIBUTION_ID.SET,
          title: 'Set Storage',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        },
        {
          id: STORAGE_CONTRIBUTION_ID.DELETE,
          title: 'Delete Storage',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
        },
        {
          id: STORAGE_CONTRIBUTION_ID.LIST,
          title: 'List Storage',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
        },
      ],
    },
  })
}

export function makeStorageUiBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        methods: [...STORAGE_METHODS],
        scopes: ['app', 'project', 'session', 'branch'],
      },
    ],
    contributions: {
      settingsSections: [
        {
          id: STORAGE_CONTRIBUTION_ID.SETTINGS,
          title: 'Storage Settings',
          lane: 'declarative',
          entry: 'dist/settings.js',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          methods: [...STORAGE_METHODS],
        },
      ],
    },
  })
}

export function makeStorageInvocation(input: {
  readonly contributionId: string
  readonly method: string
  readonly storageKind?: (typeof OPENWAGGLE_EXTENSION.STORAGE.KINDS)[number]
  readonly storageScope?: (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number]
  readonly key?: string
  readonly value?: JsonValue
  readonly scope?: ExtensionInvokeInput['scope']
}): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: input.contributionId,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
    method: input.method,
    scope: input.scope ?? { kind: 'project', projectPath: PROJECT_PATH },
    payload: {
      storageKind: input.storageKind ?? OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
      storageScope: input.storageScope ?? OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
      ...(input.key !== undefined ? { key: input.key } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
    },
  }
}
