import type { SourceControlHostChoice, SourceControlProviderId } from '@shared/types/git'

export const SOURCE_CONTROL_PROVIDER_OPTIONS: readonly {
  readonly id: SourceControlProviderId
  readonly label: string
}[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
]

/** What a host can be set to in Settings: a provider, or neither. */
export const SOURCE_CONTROL_HOST_CHOICES: readonly {
  readonly id: SourceControlHostChoice
  readonly label: string
}[] = [...SOURCE_CONTROL_PROVIDER_OPTIONS, { id: 'unsupported', label: 'Neither' }]
