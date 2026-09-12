import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

export function profileRejectionMessage(code: string) {
  return `Profile operation was rejected: ${code.replaceAll('_', ' ')}.`
}

export function useRestrictedCliProfiles(open: boolean) {
  const [profiles, setProfiles] = useState<readonly LocalSessionProfileSummary[]>([])
  const [editing, setEditing] = useState<LocalSessionProfileSummary | 'create' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .manageAccessProfiles({ operation: 'list' })
      .then((response) => {
        if (cancelled) return
        if (response.outcome.effect === 'profiles-listed') setProfiles(response.outcome.profiles)
        else {
          setError(
            response.outcome.effect === 'rejected'
              ? profileRejectionMessage(response.outcome.code)
              : 'OpenWaggle returned an unexpected profile response.',
          )
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function replaceProfile(profile: LocalSessionProfileSummary) {
    setProfiles((current) =>
      [...current.filter((candidate) => candidate.id !== profile.id), profile].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    )
  }

  async function mutate(command: Parameters<typeof api.manageAccessProfiles>[0]) {
    setError(null)
    const response = await api.manageAccessProfiles(command)
    if (response.outcome.effect === 'rejected') {
      throw new Error(profileRejectionMessage(response.outcome.code))
    }
    if ('profile' in response.outcome) replaceProfile(response.outcome.profile)
  }

  async function confirmedMutation(input: {
    readonly profile: LocalSessionProfileSummary
    readonly operation: 'rotate' | 'revoke'
    readonly title: string
    readonly detail: string
  }) {
    if (!(await api.showConfirm(input.title, input.detail))) return
    try {
      await mutate({ operation: input.operation, profileName: input.profile.name })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return {
    profiles,
    editing,
    setEditing,
    loading,
    error,
    mutate,
    rotate: (profile: LocalSessionProfileSummary) =>
      confirmedMutation({
        profile,
        operation: 'rotate',
        title: `Rotate the credential for ${profile.name}?`,
        detail:
          'Existing clients using the old credential will disconnect and must use the newly stored credential.',
      }),
    revoke: (profile: LocalSessionProfileSummary) =>
      confirmedMutation({
        profile,
        operation: 'revoke',
        title: `Revoke ${profile.name}?`,
        detail:
          'Affected runs will be interrupted, Follow-up delivery will pause, and this cannot be undone.',
      }),
  }
}
