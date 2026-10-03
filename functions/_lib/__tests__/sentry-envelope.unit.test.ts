import { describe, expect, it } from 'vitest'
import { decodeUtf8, encodeUtf8 } from '../http'
import { parseSentryDsn } from '../sentry-dsn'
import { parseSentryEnvelope, serializeSentryEnvelope } from '../sentry-envelope'

function text(bytes: Uint8Array) {
  return decodeUtf8(bytes)
}

describe('Sentry envelopes', () => {
  it('reads payloads with and without a byte length, blank lines and a missing final newline', () => {
    const payload = '{"message":"Grüße 👋"}'
    const body = [
      '{"event_id":"1"}',
      `{"type":"event","length":${encodeUtf8(payload).byteLength}}`,
      payload,
      '',
      '{"type":"session"}',
      '{"sid":"2"}',
      '{"type":"attachment","length":3}',
      'a\nb',
    ].join('\n')

    const envelope = parseSentryEnvelope(encodeUtf8(body), 10)

    expect(envelope?.header).toEqual({ event_id: '1' })
    expect(envelope?.items.map((item) => item.header.type)).toEqual([
      'event',
      'session',
      'attachment',
    ])
    expect(envelope?.items.map((item) => text(item.payload))).toEqual([
      payload,
      '{"sid":"2"}',
      'a\nb',
    ])
  })

  it.each([
    ['a header that is not JSON', 'nope\n'],
    ['a header that is not an object', '[1]\n'],
    ['an item header that is not JSON', '{}\nnope\n{}\n'],
    ['a length past the end', '{}\n{"type":"event","length":50}\n{}\n'],
    ['a negative length', '{}\n{"type":"event","length":-1}\n{}\n'],
    ['a fractional length', '{}\n{"type":"event","length":1.5}\n{}\n'],
    ['invalid UTF-8 in a header', '\u00ff'],
  ])('refuses %s', (_label, body) => {
    const bytes = body === '\u00ff' ? new Uint8Array([0xff, 0xfe, 0x0a]) : encodeUtf8(body)
    expect(parseSentryEnvelope(bytes, 10)).toBeUndefined()
  })

  it('refuses an envelope with more items than allowed', () => {
    const body = ['{}', ...Array.from({ length: 3 }, () => '{"type":"event"}\n{}')].join('\n')
    expect(parseSentryEnvelope(encodeUtf8(body), 2)).toBeUndefined()
    expect(parseSentryEnvelope(encodeUtf8(body), 3)?.items).toHaveLength(3)
  })

  it('writes the byte length of every payload so it reads back unchanged', () => {
    const written = serializeSentryEnvelope({ dsn: 'x' }, [
      { type: 'event', payload: { message: 'Grüße\nzwei Zeilen' } },
    ])
    const envelope = parseSentryEnvelope(encodeUtf8(written), 10)

    expect(written.split('\n')[1]).toBe(
      `{"type":"event","length":${encodeUtf8(JSON.stringify({ message: 'Grüße\nzwei Zeilen' })).byteLength}}`,
    )
    expect(envelope?.items.map((item) => JSON.parse(text(item.payload) ?? ''))).toEqual([
      { message: 'Grüße\nzwei Zeilen' },
    ])
  })
})

describe('Sentry DSN', () => {
  it.each([
    [
      'https://key@o1.ingest.de.sentry.io/4507',
      'https://o1.ingest.de.sentry.io/api/4507/envelope/',
    ],
    [
      'https://key@o1.ingest.de.sentry.io/prefix/12/',
      'https://o1.ingest.de.sentry.io/prefix/api/12/envelope/',
    ],
    [
      'https://key:secret@o1.ingest.de.sentry.io:8443/7',
      'https://o1.ingest.de.sentry.io:8443/api/7/envelope/',
    ],
  ])('sends %s envelopes to %s', (dsn, envelopeUrl) => {
    expect(parseSentryDsn(dsn)).toEqual({ dsn, envelopeUrl })
  })

  it.each([
    'http://key@o1.ingest.de.sentry.io/1',
    'https://o1.ingest.de.sentry.io/1',
    'https://key@o1.ingest.de.sentry.io/project',
    'https://key@o1.ingest.de.sentry.io/',
    'https://key@o1.ingest.sentry.io/1',
    'https://key@o1.ingest.us.sentry.io/1',
    'https://key@sentry.example.com/1',
    'https://key@o1.ingest.de.sentry.io.evil.example/1',
    'not a url',
  ])('refuses %s', (dsn) => {
    expect(parseSentryDsn(dsn)).toBeUndefined()
  })
})
