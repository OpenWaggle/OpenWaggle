import { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer } from '@shared/types/question'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAllWindowsMock, registerQuestionMock, cancelQuestionMock, executeFnRef } = vi.hoisted(
  () => ({
    getAllWindowsMock: vi.fn(),
    registerQuestionMock: vi.fn(),
    cancelQuestionMock: vi.fn(),
    // Mutable ref to capture the execute function
    executeFnRef: { current: null as null | ((...args: unknown[]) => unknown) },
  }),
)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}))

vi.mock('../question-manager', () => ({
  registerQuestion: registerQuestionMock,
  cancelQuestion: cancelQuestionMock,
}))

vi.mock('../define-tool', () => ({
  defineOpenWaggleTool: (config: { execute: (...args: unknown[]) => unknown }) => {
    executeFnRef.current = config.execute
    return { _captured: true }
  },
}))

// Import triggers module evaluation, which calls defineOpenWaggleTool and captures execute
import './ask-user'

type ExecuteFn = (
  args: {
    questions: Array<{
      question: string
      options: Array<{ label: string; description?: string }>
    }>
  },
  context: { conversationId: ConversationId; signal?: AbortSignal },
) => Promise<string>

function getExecute(): ExecuteFn {
  if (!executeFnRef.current) {
    throw new Error('execute was not captured — defineOpenWaggleTool mock did not fire')
  }
  return executeFnRef.current as ExecuteFn
}

function makeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  }
}

describe('askUserTool execute', () => {
  beforeEach(() => {
    getAllWindowsMock.mockReset()
    registerQuestionMock.mockReset()
    cancelQuestionMock.mockReset()
  })

  it('sends question event to all non-destroyed windows', async () => {
    const win1 = makeWindow(false)
    const win2 = makeWindow(true) // destroyed
    const win3 = makeWindow(false)
    getAllWindowsMock.mockReturnValue([win1, win2, win3])

    const answers: QuestionAnswer[] = [{ question: 'Pick a color', selectedOption: 'blue' }]
    registerQuestionMock.mockImplementation(
      (_id: unknown, resolve: (v: QuestionAnswer[]) => void) => {
        resolve(answers)
      },
    )

    const questions = [{ question: 'Pick a color', options: [{ label: 'blue' }, { label: 'red' }] }]
    const context = { conversationId: ConversationId('conv-1') }

    const result = await getExecute()({ questions }, context)

    expect(win1.webContents.send).toHaveBeenCalledWith('agent:question', {
      conversationId: ConversationId('conv-1'),
      questions,
    })
    expect(win2.webContents.send).not.toHaveBeenCalled()
    expect(win3.webContents.send).toHaveBeenCalledWith('agent:question', {
      conversationId: ConversationId('conv-1'),
      questions,
    })

    expect(result).toBe(JSON.stringify({ answers }))
  })

  it('registers the question and blocks until answered', async () => {
    getAllWindowsMock.mockReturnValue([makeWindow()])

    const answers: QuestionAnswer[] = [{ question: 'Framework?', selectedOption: 'React' }]
    registerQuestionMock.mockImplementation(
      (_id: unknown, resolve: (v: QuestionAnswer[]) => void) => {
        setTimeout(() => resolve(answers), 10)
      },
    )

    const questions = [{ question: 'Framework?', options: [{ label: 'React' }, { label: 'Vue' }] }]
    const context = { conversationId: ConversationId('conv-1') }

    const result = await getExecute()({ questions }, context)

    expect(registerQuestionMock).toHaveBeenCalledWith(
      ConversationId('conv-1'),
      expect.any(Function),
      expect.any(Function),
    )
    expect(result).toBe(JSON.stringify({ answers }))
  })

  it('cancels question and rejects when signal is already aborted', async () => {
    getAllWindowsMock.mockReturnValue([makeWindow()])

    const abortController = new AbortController()
    abortController.abort()

    registerQuestionMock.mockImplementation(() => {
      // Don't resolve — signal check handles rejection
    })

    const questions = [{ question: 'Pick?', options: [{ label: 'A' }] }]
    const context = {
      conversationId: ConversationId('conv-1'),
      signal: abortController.signal,
    }

    await expect(getExecute()({ questions }, context)).rejects.toThrow('Question cancelled')
    expect(cancelQuestionMock).toHaveBeenCalledWith(ConversationId('conv-1'))
  })

  it('cancels question when signal fires abort after registration', async () => {
    getAllWindowsMock.mockReturnValue([makeWindow()])

    const abortController = new AbortController()

    registerQuestionMock.mockImplementation(() => {
      // Don't resolve — simulate waiting for user input
    })

    const questions = [{ question: 'Choose?', options: [{ label: 'X' }] }]
    const context = {
      conversationId: ConversationId('conv-1'),
      signal: abortController.signal,
    }

    // Start execute — hangs because registerQuestion never resolves
    const _executePromise = getExecute()({ questions }, context)

    // Fire abort
    abortController.abort()

    // Let the abort listener fire
    await new Promise((r) => setTimeout(r, 10))

    expect(cancelQuestionMock).toHaveBeenCalledWith(ConversationId('conv-1'))
  })

  it('returns JSON stringified answers', async () => {
    getAllWindowsMock.mockReturnValue([makeWindow()])

    const answers: QuestionAnswer[] = [
      { question: 'Q1', selectedOption: 'A' },
      { question: 'Q2', selectedOption: 'B' },
    ]
    registerQuestionMock.mockImplementation(
      (_id: unknown, resolve: (v: QuestionAnswer[]) => void) => {
        resolve(answers)
      },
    )

    const questions = [
      { question: 'Q1', options: [{ label: 'A' }] },
      { question: 'Q2', options: [{ label: 'B' }] },
    ]
    const context = { conversationId: ConversationId('conv-1') }

    const result = await getExecute()({ questions }, context)
    const parsed = JSON.parse(result) as { answers: QuestionAnswer[] }

    expect(parsed.answers).toEqual(answers)
    expect(parsed.answers).toHaveLength(2)
  })

  it('handles empty windows list gracefully', async () => {
    getAllWindowsMock.mockReturnValue([])

    const answers: QuestionAnswer[] = [{ question: 'Q', selectedOption: 'Opt' }]
    registerQuestionMock.mockImplementation(
      (_id: unknown, resolve: (v: QuestionAnswer[]) => void) => {
        resolve(answers)
      },
    )

    const questions = [{ question: 'Q', options: [{ label: 'Opt' }] }]
    const context = { conversationId: ConversationId('conv-1') }

    const result = await getExecute()({ questions }, context)
    expect(result).toBe(JSON.stringify({ answers }))
  })

  it('works without a signal in context', async () => {
    getAllWindowsMock.mockReturnValue([makeWindow()])

    const answers: QuestionAnswer[] = [{ question: 'Q', selectedOption: 'A' }]
    registerQuestionMock.mockImplementation(
      (_id: unknown, resolve: (v: QuestionAnswer[]) => void) => {
        resolve(answers)
      },
    )

    const questions = [{ question: 'Q', options: [{ label: 'A' }] }]
    // No signal in context
    const context = { conversationId: ConversationId('conv-1') }

    const result = await getExecute()({ questions }, context)
    expect(result).toBe(JSON.stringify({ answers }))
    expect(cancelQuestionMock).not.toHaveBeenCalled()
  })
})
