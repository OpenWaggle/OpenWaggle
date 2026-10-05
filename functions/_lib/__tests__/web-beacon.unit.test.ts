import { describe, expect, it } from 'vitest'
import { referrerDetails, validateWebBeacon } from '../web-beacon'
import type { WebBeacon } from '../web-beacon-contract'

function pageview(
  referrer: string,
  utm: Partial<Record<'utm_source' | 'utm_medium', string>> = {},
) {
  return { type: 'pageview', path: '/', referrer, ...utm } satisfies WebBeacon
}

describe('website referrers', () => {
  it.each([
    ['https://www.google.com', 'www.google.com', 'search'],
    ['https://www.google.co.uk', 'www.google.co.uk', 'search'],
    ['https://duckduckgo.com', 'duckduckgo.com', 'search'],
    ['https://search.brave.com', 'search.brave.com', 'search'],
    ['https://t.co', 't.co', 'social'],
    ['https://news.ycombinator.com', 'news.ycombinator.com', 'social'],
    ['https://www.reddit.com', 'www.reddit.com', 'social'],
    ['https://github.com', 'github.com', 'referral'],
    ['https://docs.google.com', 'docs.google.com', 'referral'],
    ['http://blog.example', 'blog.example', 'referral'],
  ])('classifies %s as %s / %s', (referrer, domain, channel) => {
    expect(referrerDetails(pageview(referrer), 'openwaggle.ai')).toEqual({
      referrer,
      referringDomain: domain,
      channel,
    })
  })

  it('keeps only the referring origin, never its path or query', () => {
    expect(
      referrerDetails(pageview('https://example.com/a/b?email=x@y.z#top'), 'openwaggle.ai')
        .referrer,
    ).toBe('https://example.com')
  })

  it.each([
    [{}, 'direct'],
    [{ utm_source: 'google' }, 'search'],
    [{ utm_source: 'hackernews' }, 'social'],
    [{ utm_source: 'newsletter', utm_medium: 'email' }, 'referral'],
  ])('classifies a visit without a referrer and tags %j as %s', (utm, channel) => {
    expect(referrerDetails(pageview('', utm), 'openwaggle.ai')).toEqual({
      referrer: '$direct',
      referringDomain: '$direct',
      channel,
    })
  })
})

describe('website beacon validation', () => {
  it('accepts a minimal page view and a download click', () => {
    expect(validateWebBeacon({ type: 'pageview', path: '/', referrer: '' })).toEqual({
      ok: true,
      value: { type: 'pageview', path: '/', referrer: '' },
    })
    expect(
      validateWebBeacon({
        type: 'download_click',
        path: '/',
        referrer: '',
        target: 'install_script',
      }),
    ).toEqual({
      ok: true,
      value: { type: 'download_click', target: 'install_script', path: '/', referrer: '' },
    })
  })

  it.each([
    [null, 'beacon'],
    [[], 'beacon'],
    [{ type: 'pageview', path: 'docs', referrer: '' }, 'path'],
    [{ type: 'pageview', path: '/a b', referrer: '' }, 'path'],
    [{ type: 'pageview', path: '/', referrer: 'ftp://files.example' }, 'referrer'],
    [{ type: 'pageview', path: '/', referrer: '', utm_term: 'line\nbreak' }, 'utm_term'],
    [{ type: 'pageview', path: '/', referrer: '', utm_source: 7 }, 'utm_source'],
  ])('rejects %j at %s', (beacon, field) => {
    expect(validateWebBeacon(beacon)).toMatchObject({ ok: false, field })
  })
})
