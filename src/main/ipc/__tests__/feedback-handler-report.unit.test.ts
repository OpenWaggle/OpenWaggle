import os from 'node:os'
import type { FeedbackPayload } from '@shared/types/feedback'
import { describe, expect, it, vi } from 'vitest'
import { harness, invoke, markdown, NO_SECTIONS, writeLogs } from './feedback-handler.test-harness'

describe('feedback:generate-markdown', () => {
  it('writes every requested section in order', async () => {
    await writeLogs('log line')

    const body = await markdown({
      description: '',
      includeModelInfo: true,
      activeProvider: 'anthropic',
      activeModel: 'claude-test',
      includeErrorContext: true,
      lastErrorContext: {
        code: 'rate-limited',
        message: 'Too many requests',
        userMessage: 'Rate limited',
        suggestion: 'Wait and retry',
        retryable: true,
      },
      includeLastMessage: true,
      lastUserMessage: 'fix the build',
      includeLogs: true,
    })

    expect(body).toBe(
      [
        '## Description\n\n_No description provided._',
        '## Model Info\n\n- **Provider:** anthropic\n- **Model:** claude-test',
        '## Error Context\n\n- **Code:** `rate-limited`\n- **Message:** Rate limited\n' +
          '- **Suggestion:** Wait and retry\n\n<details><summary>Raw error</summary>\n\n' +
          '```\nToo many requests\n```\n\n</details>',
        '## Last User Message\n\n<details><summary>Message content</summary>\n\n' +
          '```\nfix the build\n```\n\n</details>',
        '## Recent Logs\n\n<details><summary>Last 100 lines (redacted)</summary>\n\n' +
          '```\nlog line\n```\n\n</details>',
      ].join('\n\n'),
    )
  })

  it('lists the system info rows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    await expect(markdown({ includeSystemInfo: true })).resolves.toBe(
      [
        '## Description\n\nSomething broke',
        [
          '## System Info',
          '',
          '| Field | Value |',
          '|-------|-------|',
          `| OS | Linux ${os.release()} |`,
          '| App Version | 0.1.0-test |',
          `| Electron | ${process.versions.electron} |`,
          `| Node.js | ${process.versions.node} |`,
          `| Arch | ${process.arch} |`,
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it.each<[string, Partial<FeedbackPayload>, string | undefined]>([
    ['the provider alone', { activeProvider: 'anthropic' }, '- **Provider:** anthropic'],
    ['the model alone', { activeModel: 'claude-test' }, '- **Model:** claude-test'],
    ['no model section without a model or provider', {}, undefined],
  ])('writes %s', async (_name, model, line) => {
    const body = await markdown({ includeModelInfo: true, ...model })

    if (line === undefined) expect(body).not.toContain('## Model Info')
    else expect(body).toBe(`## Description\n\nSomething broke\n\n## Model Info\n\n${line}`)
  })

  it('leaves out the suggestion line when the error has none', async () => {
    const body = await markdown({
      includeErrorContext: true,
      lastErrorContext: {
        code: 'unknown',
        message: 'boom',
        userMessage: 'Failed',
        retryable: false,
      },
    })

    expect(body).toContain('- **Message:** Failed\n\n<details>')
    expect(body).not.toContain('Suggestion')
  })

  it('redacts credentials in the raw error before it reaches the report', async () => {
    const body = await markdown({
      includeErrorContext: true,
      lastErrorContext: {
        code: 'unknown',
        message:
          'upstream said: Authorization: Bearer abcdef0123456789secret ANTHROPIC_API_KEY=abcdef1234567890 API key: xyz9876543210',
        userMessage: 'Something went wrong',
        retryable: true,
      },
    })

    expect(body).not.toContain('abcdef0123456789secret')
    expect(body).toContain('Bearer [REDACTED_TOKEN]')
    expect(body).not.toContain('abcdef1234567890')
    expect(body).not.toContain('xyz9876543210')
  })

  it.each<[string, Partial<FeedbackPayload>]>([
    [
      'error context the person left out',
      { lastErrorContext: { code: 'unknown', message: 'x', userMessage: 'x', retryable: false } },
    ],
    ['an error section with no error', { includeErrorContext: true }],
    ['a last message the person left out', { lastUserMessage: 'hello' }],
    ['a last message section with no message', { includeLastMessage: true }],
    ['a logs section when the app has no log', { includeLogs: true }],
  ])('writes only the description for %s', async (_name, overrides) => {
    await expect(markdown(overrides)).resolves.toBe('## Description\n\nSomething broke')
  })

  it('leaves out the logs the person did not include', async () => {
    await writeLogs('log line')

    await expect(markdown({})).resolves.toBe('## Description\n\nSomething broke')
  })
})

describe('feedback:submit', () => {
  const create = (...extra: string[]) =>
    [
      'gh',
      'issue',
      'create',
      '--repo',
      'OpenWaggle/OpenWaggle',
      '--title',
      'Bug',
      '--body',
      '## Description\n\nSomething broke',
      ...extra,
    ].join(' ')

  it('files a labelled issue and returns its URL', async () => {
    harness.replies.set(create('--label', 'bug'), {
      stdout: 'Creating issue\nhttps://github.com/OpenWaggle/OpenWaggle/issues/12\n',
    })

    await expect(invoke('feedback:submit', NO_SECTIONS)).resolves.toEqual({
      success: true,
      issueUrl: 'https://github.com/OpenWaggle/OpenWaggle/issues/12',
    })
  })

  it('files the issue without a label the repository does not have', async () => {
    harness.replies.set(create(), { stdout: 'https://github.com/OpenWaggle/OpenWaggle/issues/13' })

    await expect(invoke('feedback:submit', NO_SECTIONS)).resolves.toEqual({
      success: true,
      issueUrl: 'https://github.com/OpenWaggle/OpenWaggle/issues/13',
    })
    expect(harness.spawned.map(({ args }) => args.includes('--label'))).toEqual([true, false])
  })

  it('reports success with no URL when gh prints none', async () => {
    harness.replies.set(create('--label', 'bug'), { stdout: 'created\n' })

    await expect(invoke('feedback:submit', NO_SECTIONS)).resolves.toStrictEqual({ success: true })
  })

  it("returns gh's error when the issue cannot be filed", async () => {
    harness.replies.set(create(), { fails: true, stderr: 'HTTP 401: Bad credentials' })

    await expect(invoke('feedback:submit', NO_SECTIONS)).resolves.toEqual({
      success: false,
      error: 'HTTP 401: Bad credentials',
    })
  })
})
