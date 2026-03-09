import { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer } from '@shared/types/question'
import { describe, expect, it, vi } from 'vitest'
import { answerQuestion, cancelQuestion, registerQuestion } from '../question-manager'

function makeConversationId(suffix: string): ConversationId {
  return ConversationId(`conv-qm-${suffix}`)
}

describe('registerQuestion + answerQuestion', () => {
  it('calls resolve with answers', () => {
    const conversationId = makeConversationId('answer-1')
    const resolve = vi.fn()
    const reject = vi.fn()

    registerQuestion(conversationId, resolve, reject)

    const answers: QuestionAnswer[] = [{ question: 'Pick a color', selectedOption: 'blue' }]
    answerQuestion(conversationId, answers)

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith(answers)
    expect(reject).not.toHaveBeenCalled()
  })
})

describe('answerQuestion', () => {
  it('throws when no pending question exists', () => {
    const conversationId = makeConversationId('no-pending')

    expect(() => answerQuestion(conversationId, [])).toThrow(
      `No pending question for conversation ${conversationId}`,
    )
  })
})

describe('cancelQuestion', () => {
  it('rejects pending question with "Question cancelled"', () => {
    const conversationId = makeConversationId('cancel-1')
    const resolve = vi.fn()
    const reject = vi.fn()

    registerQuestion(conversationId, resolve, reject)
    cancelQuestion(conversationId)

    expect(reject).toHaveBeenCalledOnce()
    const error = reject.mock.calls[0][0]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Question cancelled')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('is a no-op when no pending question exists', () => {
    const conversationId = makeConversationId('cancel-noop')

    // Should not throw
    expect(() => cancelQuestion(conversationId)).not.toThrow()
  })
})

describe('registerQuestion superseding', () => {
  it('rejects old pending question when a new one is registered', () => {
    const conversationId = makeConversationId('supersede')
    const resolve1 = vi.fn()
    const reject1 = vi.fn()
    const resolve2 = vi.fn()
    const reject2 = vi.fn()

    registerQuestion(conversationId, resolve1, reject1)
    registerQuestion(conversationId, resolve2, reject2)

    // The first question should have been rejected
    expect(reject1).toHaveBeenCalledOnce()
    const error = reject1.mock.calls[0][0]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Superseded by a new question')

    // The second question should still be pending and answerable
    const answers: QuestionAnswer[] = [{ question: 'Pick a shape', selectedOption: 'circle' }]
    answerQuestion(conversationId, answers)

    expect(resolve2).toHaveBeenCalledOnce()
    expect(resolve2).toHaveBeenCalledWith(answers)
    expect(reject2).not.toHaveBeenCalled()
  })
})
