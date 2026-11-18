import { describe, expect, it } from 'vitest'
import {
  mapGhPullRequest,
  mapGhPullRequestDetails,
  mapGhState,
  mapGlabMergeRequest,
  mapGlabMergeRequestDetails,
  mapGlabState,
} from '../change-request-parse'

describe('change-request-parse', () => {
  it('maps bounded GitHub lifecycle details into the provider-neutral model', () => {
    expect(
      mapGhPullRequestDetails({
        number: 7,
        title: 'Add feature',
        url: 'https://github.com/o/r/pull/7',
        baseRefName: 'main',
        headRefName: 'feat',
        headRefOid: 'abc123',
        state: 'OPEN',
        isDraft: false,
        author: { login: 'octocat' },
        changedFiles: 2,
        additions: 12,
        deletions: 3,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        comments: [{ id: 'comment-1' }],
        latestReviews: [{ id: 'review-1' }],
        files: [
          { path: 'src/a.ts', additions: 10, deletions: 1 },
          { path: 'src/b.ts', additions: 2, deletions: 2 },
        ],
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'test',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/o/r/actions/runs/1',
          },
          {
            __typename: 'StatusContext',
            context: 'deploy',
            state: 'PENDING',
            targetUrl: 'https://example.test/deploy',
          },
          { __typename: 'StatusContext', context: 'policy', state: 'SUCCESS' },
        ],
      }),
    ).toEqual({
      title: 'Add feature',
      url: 'https://github.com/o/r/pull/7',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
      reference: '7',
      headCommit: 'abc123',
      author: 'octocat',
      changedFiles: 2,
      additions: 12,
      deletions: 3,
      files: [
        { path: 'src/a.ts', additions: 10, deletions: 1 },
        { path: 'src/b.ts', additions: 2, deletions: 2 },
      ],
      checks: [
        {
          name: 'test',
          status: 'passed',
          url: 'https://github.com/o/r/actions/runs/1',
        },
        { name: 'deploy', status: 'pending', url: 'https://example.test/deploy' },
        { name: 'policy', status: 'passed', url: null },
      ],
      reviewDecision: 'approved',
      mergeability: 'mergeable',
      commentsCount: 1,
      reviewsCount: 1,
      reviewThreadsCount: null,
      unresolvedReviewThreadsCount: null,
      merge: {
        allowed: false,
        reason: 'Wait for all checks to finish before merging.',
        methods: ['merge', 'squash', 'rebase'],
      },
    })
  })

  it('maps a gh PR json object', () => {
    expect(
      mapGhPullRequest({
        title: 'Add feature',
        url: 'https://github.com/o/r/pull/7',
        baseRefName: 'main',
        headRefName: 'feat',
        state: 'OPEN',
        isDraft: false,
      }),
    ).toEqual({
      title: 'Add feature',
      url: 'https://github.com/o/r/pull/7',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
    })
  })

  it('maps a glab MR json object with draft', () => {
    expect(
      mapGlabMergeRequest({
        title: 'WIP',
        web_url: 'https://gitlab.com/o/r/-/merge_requests/3',
        target_branch: 'main',
        source_branch: 'feat',
        state: 'opened',
        draft: true,
      }),
    ).toMatchObject({ url: 'https://gitlab.com/o/r/-/merge_requests/3', state: 'draft' })
  })

  it('maps GitLab lifecycle details and fails closed while conflicts exist', () => {
    expect(
      mapGlabMergeRequestDetails({
        iid: 12,
        title: 'Ship feature',
        web_url: 'https://gitlab.com/o/r/-/merge_requests/12',
        target_branch: 'main',
        source_branch: 'feat',
        state: 'opened',
        draft: false,
        sha: 'deadbeef',
        author: { username: 'fox' },
        changes_count: '2',
        diff_stats: [
          { path: 'src/a.ts', additions: 4, deletions: 1 },
          { new_path: 'src/b.ts', additions: 2, deletions: 0 },
        ],
        has_conflicts: true,
        detailed_merge_status: 'conflict',
        user_notes_count: 3,
        approvals_left: 0,
        discussions: [{ resolved: true }, { resolved: false }],
        head_pipeline: {
          name: 'pipeline',
          status: 'failed',
          web_url: 'https://gitlab.com/o/r/-/pipelines/9',
        },
      }),
    ).toEqual({
      title: 'Ship feature',
      url: 'https://gitlab.com/o/r/-/merge_requests/12',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
      reference: '12',
      headCommit: 'deadbeef',
      author: 'fox',
      changedFiles: 2,
      additions: 6,
      deletions: 1,
      files: [
        { path: 'src/a.ts', additions: 4, deletions: 1 },
        { path: 'src/b.ts', additions: 2, deletions: 0 },
      ],
      checks: [
        {
          name: 'pipeline',
          status: 'failed',
          url: 'https://gitlab.com/o/r/-/pipelines/9',
        },
      ],
      reviewDecision: 'approved',
      mergeability: 'conflicting',
      commentsCount: 3,
      reviewsCount: null,
      reviewThreadsCount: 2,
      unresolvedReviewThreadsCount: 1,
      merge: {
        allowed: false,
        reason: 'Resolve merge conflicts before merging.',
        methods: ['merge', 'squash', 'rebase'],
      },
    })
  })

  it('returns null for malformed input', () => {
    expect(mapGhPullRequest(null)).toBeNull()
    expect(mapGhPullRequest({ title: 'x' })).toBeNull()
    expect(mapGlabMergeRequest({})).toBeNull()
  })

  it('trims decoded string fields', () => {
    expect(
      mapGhPullRequest({
        title: '  Add feature  ',
        url: ' https://github.com/o/r/pull/7 ',
        baseRefName: ' main ',
        headRefName: ' feat ',
        state: 'OPEN',
      }),
    ).toEqual({
      title: 'Add feature',
      url: 'https://github.com/o/r/pull/7',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
    })
  })

  it('maps states with draft precedence', () => {
    expect(mapGhState('OPEN', true)).toBe('draft')
    expect(mapGhState('MERGED', false)).toBe('merged')
    expect(mapGhState('CLOSED', false)).toBe('closed')
    expect(mapGhState('OPEN', false)).toBe('open')
    expect(mapGlabState('merged', false)).toBe('merged')
    expect(mapGlabState('opened', true)).toBe('draft')
    expect(mapGlabState('opened', false)).toBe('open')
  })
})
