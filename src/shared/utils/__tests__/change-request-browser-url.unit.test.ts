import { describe, expect, it } from 'vitest'
import {
  buildHostedChangeRequestUrl,
  repositoryUrlFromChangeRequestUrl,
} from '../change-request-browser-url'

describe('change-request browser URLs', () => {
  it('recomposes GitHub title and body without provider or Git access', () => {
    const initial = buildHostedChangeRequestUrl(
      'github',
      'https://github.example.com/acme/widget',
      { headRef: 'feature', baseRef: 'main', title: '', body: '' },
      false,
    )
    expect(initial).not.toBeNull()
    const repository = repositoryUrlFromChangeRequestUrl('github', initial ?? '')

    expect(
      buildHostedChangeRequestUrl(
        'github',
        repository ?? '',
        { headRef: 'feature', baseRef: 'main', title: 'Fast title', body: 'Current body' },
        false,
      ),
    ).toBe(
      'https://github.example.com/acme/widget/compare?expand=1&title=Fast+title&body=Current+body',
    )
  })

  it('recomposes a GitLab draft URL from its repository identity', () => {
    const browserUrl =
      'https://gitlab.example.com/acme/widget/-/merge_requests/new?merge_request%5Btitle%5D=Old'
    const repository = repositoryUrlFromChangeRequestUrl('gitlab', browserUrl)

    expect(
      buildHostedChangeRequestUrl(
        'gitlab',
        repository ?? '',
        { headRef: 'feature', baseRef: 'main', title: 'New', body: 'Body', draft: true },
        false,
      ),
    ).toBe(
      'https://gitlab.example.com/acme/widget/-/merge_requests/new?merge_request%5Btarget_branch%5D=main&merge_request%5Btitle%5D=New&merge_request%5Bdescription%5D=Body&merge_request%5Bdraft%5D=true',
    )
  })
})
