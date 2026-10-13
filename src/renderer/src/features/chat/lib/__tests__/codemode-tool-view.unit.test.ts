import { describe, expect, it } from 'vitest'
import { codemodeToolView } from '../codemode-tool-view'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('codemodeToolView', () => {
  it('reads the script from the tool arguments', () => {
    expect(codemodeToolView({ code: 'return 1' }, undefined).script).toBe('return 1')
  })

  it('shows the child calls a running script has made so far', () => {
    const view = codemodeToolView(
      { code: 'await tools.bash({ command: "ls" })' },
      {
        content: [],
        details: {
          calls: [{ id: 'script/?', name: 'bash', args: '{"command":"ls"}', status: 'running' }],
        },
      },
    )

    expect(view.calls).toEqual([
      { key: 'script/?:0', name: 'bash', args: '{"command":"ls"}', status: 'running' },
    ])
  })

  it('splits a finished result into output text, images and model call cost', () => {
    const view = codemodeToolView(
      { code: '...' },
      {
        content: [
          { type: 'text', text: 'Script completed\nWall time 0.4 seconds\nOutput:\n' },
          { type: 'text', text: 'Saved image to /tmp/fox.png' },
          { type: 'image', data: PNG_PIXEL, mimeType: 'image/png' },
        ],
        details: {
          calls: [
            {
              id: 'script/models.generateImages/1',
              name: 'models.generateImages',
              args: 'openrouter/painter',
              status: 'ok',
              durationMs: 2100,
              cost: 0.04,
            },
            {
              id: 'script/2',
              name: 'read',
              args: '{"path":"a.ts"}',
              status: 'error',
              error: 'ENOENT',
            },
          ],
        },
      },
    )

    expect(view.output).toBe(
      'Script completed\nWall time 0.4 seconds\nOutput:\n\nSaved image to /tmp/fox.png',
    )
    expect(view.images).toEqual([
      { key: 'image:2', src: `data:image/png;base64,${PNG_PIXEL}`, mimeType: 'image/png' },
    ])
    expect(view.calls.map((call) => [call.name, call.status, call.cost, call.error])).toEqual([
      ['models.generateImages', 'ok', 0.04, undefined],
      ['read', 'error', undefined, 'ENOENT'],
    ])
    expect(view.modelCost).toBe(0.04)
  })

  it('ignores image blocks it cannot show safely', () => {
    const view = codemodeToolView(
      { code: '...' },
      {
        content: [
          { type: 'image', data: PNG_PIXEL, mimeType: 'image/svg+xml' },
          { type: 'image', data: 'not base64!', mimeType: 'image/png' },
        ],
      },
    )

    expect(view.images).toEqual([])
  })
})
