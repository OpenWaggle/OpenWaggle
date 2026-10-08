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

    expect(screen.getByText('Running a script…')).toBeInTheDocument()
    const calls = screen.getByRole('list', { name: 'Calls made by the script' })
    expect(within(calls).getByText('bash')).toBeInTheDocument()
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
    expect(screen.getByText('2 tool calls')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Script output 1' })).toHaveAttribute(
      'src',
      `data:image/png;base64,${PNG_PIXEL}`,
    )
    expect(
      within(screen.getByRole('button', { name: /Ran a script/u })).getByText('$0.0123'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Calls made by the script' })).getByText(
        'models.classify',
      ),
    ).toBeInTheDocument()
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

    expect(screen.getByText('Script failed')).toBeInTheDocument()
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
