import { expect, it } from 'vitest'
import { previewFromActionOutput } from '../action-run-output'

it('detects only loopback URLs in action output', () => {
  expect(previewFromActionOutput('ready: http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/')
  expect(previewFromActionOutput('ready: http://127.255.255.254:3000/')).toBe(
    'http://127.255.255.254:3000/',
  )
  expect(previewFromActionOutput('ready: http://[::1]:3000/')).toBe('http://[::1]:3000/')
  expect(previewFromActionOutput('ready: http://0.0.0.0:3000/')).toBe('http://localhost:3000/')
})

it('ignores DNS names that begin with a loopback-looking prefix', () => {
  expect(previewFromActionOutput('ready: http://127.attacker.example/')).toBeNull()
  expect(previewFromActionOutput('ready: http://127.0.0.1.attacker.example/')).toBeNull()
  expect(
    previewFromActionOutput('ready: http://127.attacker.example/ http://localhost:3000/'),
  ).toBe('http://localhost:3000/')
})
