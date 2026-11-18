import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
  formatCreateChangeRequest,
  formatViewChangeRequest,
  getChangeRequestTerminology,
} from '../source-control-presentation'

describe('source-control-presentation', () => {
  it('uses PR terminology for github', () => {
    const t = getChangeRequestTerminology('github')
    expect(t.shortLabel).toBe('PR')
    expect(t.singular).toBe('pull request')
    expect(t.providerName).toBe('GitHub')
  })

  it('uses MR terminology for gitlab', () => {
    const t = getChangeRequestTerminology('gitlab')
    expect(t.shortLabel).toBe('MR')
    expect(t.singular).toBe('merge request')
    expect(t.providerName).toBe('GitLab')
  })

  it('falls back to default terminology for unknown/null provider', () => {
    expect(getChangeRequestTerminology(null)).toEqual(DEFAULT_CHANGE_REQUEST_TERMINOLOGY)
  })

  it('formats provider-aware action labels', () => {
    expect(formatCreateChangeRequest('github')).toBe('Create PR')
    expect(formatCreateChangeRequest('gitlab')).toBe('Create MR')
    expect(formatViewChangeRequest('gitlab')).toBe('View MR')
  })
})
