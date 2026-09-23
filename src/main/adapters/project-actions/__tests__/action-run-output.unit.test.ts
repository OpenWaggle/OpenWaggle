import type { ActionRun } from '@shared/types/action-runs'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'
import { actionOutputPage, previewFromActionOutput } from '../action-run-output'

it('never moves a renderer cursor backward when its last tail was not flushed before Host loss', () => {
  const run = fromPartial<ActionRun>({ outputBytes: 4 })
  const page = actionOutputPage(run, 'old!', 20)
  expect(page.output).toBe('')
  expect(page.startOffset).toBe(20)
  expect(page.endOffset).toBe(20)
  expect(page.truncated).toBe(true)
})

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
