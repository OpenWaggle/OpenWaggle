import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({
  api: { copyToClipboard: vi.fn() },
}))

import { CodemodeToolCallBlock } from '../CodemodeToolCallBlock'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SCRIPT = 'const files = await tools.bash({ command: "ls" })\nreturn files'

function finishedResult() {
  return {
    state: 'complete',
    content: {
      content: [
        { type: 'text', text: 'Script completed\nWall time 0.4 seconds\nOutput:\n' },
        { type: 'text', text: 'a.ts b.ts' },
        { type: 'image', data: PNG_PIXEL, mimeType: 'image/png' },
      ],
      details: {
        calls: [
          { id: 's/1', name: 'bash', args: '{"command":"ls"}', status: 'ok', durationMs: 1200 },
          {
            id: 's/models.classify/1',
            name: 'models.classify',
            args: 'typesafe/jev-latest',
            status: 'ok',
            cost: 0.0123,
          },
        ],
      },
    },
  }
}

describe('CodemodeToolCallBlock', () => {
  it('lists the child calls of a running script as they happen', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="executing"
        isStreaming
        result={{
          state: 'partial',
          content: {
            content: [],
            details: {
              calls: [{ id: 's/?', name: 'bash', args: '{"command":"ls"}', status: 'running' }],
            },
          },
        }}
      />,
    )

    expect(screen.getByText('Running a script…')).toHaveClass('activity-shimmer')
    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).getByText('bash')).toHaveClass('activity-shimmer')
    expect(within(calls).getByText('{"command":"ls"}')).toBeInTheDocument()
    expect(within(calls).getByLabelText('Running')).toBeInTheDocument()
  })

  it('shows the images a finished script produced and the cost of its model calls', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="complete"
        result={finishedResult()}
      />,
    )

    expect(screen.getByText('Ran a script')).toBeInTheDocument()
    // models.* calls are counted apart from the tool calls.
    expect(screen.getByText('1 tool call, 1 model call')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Script output 1' })).toHaveAttribute(
      'src',
      `data:image/png;base64,${PNG_PIXEL}`,
    )
    expect(
      within(screen.getByRole('button', { name: /Ran a script/u })).getByText('$0.0123'),
    ).toBeInTheDocument()
    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).getByText('models.classify')).toBeInTheDocument()
    const kinds = [...calls.querySelectorAll('[data-tool-kind]')].map((icon) =>
      icon.getAttribute('data-tool-kind'),
    )
    expect(kinds).toEqual(['shell', 'other'])
  })

  it('marks failed and cancelled calls of a script apart', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="complete"
        result={{
          state: 'complete',
          content: {
            content: [{ type: 'text', text: 'Script completed\nWall time 0.4 seconds\nOutput:\n' }],
            details: {
              calls: [
                { id: 's/1', name: 'bash', args: '{}', status: 'error', error: 'exit 1' },
                { id: 's/2', name: 'read', args: '{}', status: 'cancelled' },
              ],
            },
          },
        }}
      />,
    )

    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).getByRole('img', { name: 'Failed' })).toBeInTheDocument()
    expect(within(calls).getByRole('img', { name: 'Cancelled' })).toBeInTheDocument()
    expect(calls.querySelector('[data-tool-kind="shell"]')).toHaveClass('text-error/80')
    expect(calls.querySelector('[data-tool-kind="read"]')).toHaveClass('text-error/80')
    expect(within(calls).getByText('bash')).not.toHaveClass('activity-shimmer')
  })

  it('leaves Worker waits out of the listed calls and their count', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="complete"
        result={{
          state: 'complete',
          content: {
            content: [{ type: 'text', text: 'Script completed\nWall time 0.4 seconds\nOutput:\n' }],
            details: {
              calls: [
                {
                  id: 's/1',
                  name: 'sessions',
                  // Pi previews a script call's arguments cut to 200 characters.
                  args: `${JSON.stringify({ action: 'wait', sessionIds: Array(8).fill('00000000-0000-0000-0000-000000000000') }).slice(0, 200)}...`,
                  status: 'ok',
                },
                { id: 's/2', name: 'bash', args: '{"command":"ls"}', status: 'ok' },
              ],
            },
          },
        }}
      />,
    )

    expect(screen.getByText('1 tool call')).toBeInTheDocument()
    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).queryByText('sessions')).toBeNull()
    expect(within(calls).getByText('bash')).toBeInTheDocument()
  })

  it('shows the script and its output when expanded', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="complete"
        result={finishedResult()}
      />,
    )

    expect(screen.queryByText(/Wall time/u)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ran a script/u }))

    expect(screen.getByLabelText('Script')).toHaveTextContent('tools.bash')
    expect(screen.getByLabelText('Script output')).toHaveTextContent('a.ts b.ts')
  })

  it('marks a failed script and keeps its error visible', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: 'throw new Error("boom")' })}
        state="error"
        result={{
          state: 'error',
          content: {
            content: [
              { type: 'text', text: 'Script failed\nWall time 0.1 seconds\nOutput:\n' },
              { type: 'text', text: 'Script error:\nError: boom' },
            ],
            details: { calls: [] },
          },
        }}
      />,
    )

    expect(screen.getByText('Ran a script')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ran a script, failed/u })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Error: boom')
  })

  it('shows a failed script error once, not again in the expanded output', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: 'throw new Error("boom")' })}
        state="error"
        result={{
          state: 'error',
          content: {
            content: [
              { type: 'text', text: 'Script failed\nWall time 0.1 seconds\nOutput:\npartial' },
              { type: 'text', text: 'Script error:\nError: boom' },
            ],
            details: { calls: [] },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /script/iu }))

    expect(screen.getByLabelText('Script output')).toHaveTextContent('partial')
    expect(screen.getByLabelText('Script output')).not.toHaveTextContent('Script error:')
    expect(screen.getAllByText(/Error: boom/u)).toHaveLength(1)
  })

  it('lists only model calls when the tool calls appear as nested tool cards', () => {
    render(
      <CodemodeToolCallBlock
        args={JSON.stringify({ code: SCRIPT })}
        state="complete"
        result={finishedResult()}
        nestedCallsShown
      />,
    )

    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).queryByText('bash')).not.toBeInTheDocument()
    expect(within(calls).getByText('models.classify')).toBeInTheDocument()
  })
})
