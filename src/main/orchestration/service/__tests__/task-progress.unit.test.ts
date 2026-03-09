import { describe, expect, it } from 'vitest'
import { TaskProgressTracker } from '../task-progress'

describe('TaskProgressTracker', () => {
  it('formats tool_end progress payloads decoded through Effect schema', () => {
    const tracker = new TaskProgressTracker(
      [
        {
          id: 'task-1',
          title: 'Summarize docs',
        },
      ],
      () => 0,
    )

    const progress = tracker.onTaskProgress('task-1', {
      type: 'tool_end',
      toolName: 'readFile',
      toolCallId: 'tool-1',
      toolInput: { path: 'README.md' },
    })

    expect(progress).toBe('Read README.md')
  })

  it('ignores invalid tool progress payloads', () => {
    const tracker = new TaskProgressTracker(
      [
        {
          id: 'task-1',
          title: 'Summarize docs',
        },
      ],
      () => 0,
    )

    const progress = tracker.onTaskProgress('task-1', {
      type: 'tool_end',
      toolName: 'readFile',
      toolCallId: 'tool-1',
      toolInput: 'README.md',
    })

    expect(progress).toBeNull()
  })
})
