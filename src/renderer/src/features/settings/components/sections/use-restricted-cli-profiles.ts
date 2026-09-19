import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'

export function profileRejectionMessage(code: string) {
  return `Profile operation was rejected: ${code.replaceAll('_', ' ')}.`
}

function replaceProfile(
  current: readonly LocalSessionProfileSummary[],
  profile: LocalSessionProfileSummary,
) {
  return [...current.filter((candidate) => candidate.id !== profile.id), profile].sort(
    (left, right) => left.name.localeCompare(right.name),
  )
}

type ProfileCommand = Parameters<typeof api.manageAccessProfiles>[0]

async function confirmedMutation(
  input: {
    readonly profile: LocalSessionProfileSummary
    readonly operation: 'rotate' | 'revoke'
    readonly title: string
    readonly detail: string
  },
  mutate: (command: ProfileCommand) => Promise<void>,
) {
  if (!(await api.showConfirm(input.title, input.detail))) return
  try {
    await mutate({ operation: input.operation, profileName: input.profile.name })
  } catch {
    // mutate reports the error in the card.
  }
}

export function useRestrictedCliProfiles(open: boolean) {
  const [profiles, setProfiles] = useState<readonly LocalSessionProfileSummary[]>([])
  const [editing, setEditing] = useState<LocalSessionProfileSummary | 'create' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const requestGeneration = useRef(0)
  const pendingMutations = useRef(0)

  useEffect(() => {
    if (!open) return
    void refreshVersion // A settled mutation triggers another authoritative list.
    let cancelled = false
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(null)
    api
      .manageAccessProfiles({ operation: 'list' })
      .then((response) => {
        if (cancelled || generation !== requestGeneration.current || pendingMutations.current > 0) {
          return
        }
        if (response.outcome.effect === 'profiles-listed') setProfiles(response.outcome.profiles)
        else {
          setProfiles([])
          setError(
            response.outcome.effect === 'rejected'
              ? profileRejectionMessage(response.outcome.code)
              : 'OpenWaggle returned an unexpected profile response.',
          )
        }
      })
      .catch((cause: unknown) => {
        if (
          !cancelled &&
          generation === requestGeneration.current &&
          pendingMutations.current === 0
        ) {
          setProfiles([])
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (
          !cancelled &&
          generation === requestGeneration.current &&
          pendingMutations.current === 0
        ) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, refreshVersion])

  async function mutate(command: ProfileCommand) {
    ++requestGeneration.current
    ++pendingMutations.current
    setLoading(true)
    setError(null)
    setMutationError(null)
    try {
      const response = await api.manageAccessProfiles(command)
      if (response.outcome.effect === 'rejected') {
        throw new Error(profileRejectionMessage(response.outcome.code))
      }
      if ('profile' in response.outcome) {
        const { profile } = response.outcome
        setProfiles((current) => replaceProfile(current, profile))
      }
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      // Fence lists started before or during this mutation.
      ++requestGeneration.current
      --pendingMutations.current
      if (pendingMutations.current === 0) setRefreshVersion((current) => current + 1)
    }
  }

  function invalidateList() {
    ++requestGeneration.current
    setLoading(true)
    setMutationError(null)
  }

  return {
    profiles,
    editing,
    setEditing,
    loading,
    error: mutationError ?? error,
    mutate,
    invalidateList,
    rotate: (profile: LocalSessionProfileSummary) =>
      confirmedMutation(
        {
          profile,
          operation: 'rotate',
          title: `Rotate the credential for ${profile.name}?`,
          detail:
            'Existing clients using the old credential will disconnect and must use the newly stored credential.',
        },
        mutate,
      ),
    revoke: (profile: LocalSessionProfileSummary) =>
      confirmedMutation(
        {
          profile,
          operation: 'revoke',
          title: `Revoke ${profile.name}?`,
          detail:
            'Affected runs will be interrupted, Follow-up delivery will pause, and this cannot be undone.',
        },
        mutate,
      ),
  }
}
