import type { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer, QuestionOption, UserQuestion } from '@shared/types/question'
import { askUserResultContentSchema } from '@shared/types/question'
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface AskUserBlockProps {
  questions: UserQuestion[]
  result?: { content: unknown; state: string }
  conversationId: ConversationId
  onAnswer: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
}

export function AskUserBlock({
  questions,
  result,
  conversationId,
  onAnswer,
}: AskUserBlockProps): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Map<number, string>>(new Map())
  const [submitted, setSubmitted] = useState(false)

  const isAnswered = !!result || submitted
  const isSingleQuestion = questions.length === 1
  const currentQuestion = questions[currentStep]

  // Parse answered state from result for historical messages
  let historicalAnswers: QuestionAnswer[] = []
  if (result) {
    try {
      const raw: unknown =
        typeof result.content === 'string' ? JSON.parse(result.content) : result.content
      const validated = askUserResultContentSchema.safeParse(raw)
      if (validated.success) {
        historicalAnswers =
          'data' in validated.data ? validated.data.data.answers : validated.data.answers
      }
    } catch {
      // ignore parse errors
    }
  }

  function handleSelect(optionLabel: string) {
    if (isAnswered) return
    const next = new Map(answers)
    next.set(currentStep, optionLabel)
    setAnswers(next)

    if (isSingleQuestion) {
      // Single question — submit immediately
      setSubmitted(true)
      void onAnswer(conversationId, [
        { question: questions[0].question, selectedOption: optionLabel },
      ])
    } else if (currentStep < questions.length - 1) {
      // Auto-advance to next question
      setCurrentStep(currentStep + 1)
    }
  }

  function handleSubmitAll() {
    if (isAnswered || answers.size < questions.length) return
    setSubmitted(true)
    const finalAnswers: QuestionAnswer[] = questions.map((q, i) => ({
      question: q.question,
      selectedOption: answers.get(i) ?? '',
    }))
    void onAnswer(conversationId, finalAnswers)
  }

  // Answered state — show read-only summary
  if (isAnswered) {
    const displayAnswers = historicalAnswers.length > 0 ? historicalAnswers : buildCurrentAnswers()
    return (
      <div className="rounded-lg border border-border-light bg-bg-secondary overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border">
          <MessageCircleQuestion className="h-3.5 w-3.5 text-accent" />
          <span className="text-[13px] font-medium text-text-secondary">Questions answered</span>
        </div>
        <div className="px-3.5 py-2.5 space-y-2">
          {displayAnswers.map((a) => (
            <div key={a.question} className="flex items-start gap-2">
              <Check className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] text-text-tertiary">{a.question}</div>
                <div className="text-[14px] text-text-primary">{a.selectedOption}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Active state — show questions with options
  return (
    <div className="rounded-lg border border-accent/30 bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border">
        <MessageCircleQuestion className="h-3.5 w-3.5 text-accent" />
        <span className="text-[13px] font-medium text-text-secondary">Agent needs your input</span>
        {!isSingleQuestion && (
          <span className="ml-auto text-[11px] text-text-muted">
            {currentStep + 1} / {questions.length}
          </span>
        )}
      </div>

      {/* Step dots for multi-question */}
      {!isSingleQuestion && (
        <div className="flex items-center gap-1.5 px-3.5 pt-2.5">
          {questions.map((_, idx) => (
            <div
              key={`step-${String(idx)}`}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === currentStep
                  ? 'w-4 bg-accent'
                  : idx < currentStep && answers.has(idx)
                    ? 'w-1.5 bg-success'
                    : 'w-1.5 bg-border-light',
              )}
            />
          ))}
        </div>
      )}

      {/* Question */}
      {currentQuestion && (
        <div className="px-3.5 py-3">
          <p className="text-[14px] text-text-primary mb-3">{currentQuestion.question}</p>
          <div className="flex flex-col gap-1.5">
            {currentQuestion.options.map((opt) => (
              <OptionButton
                key={opt.label}
                option={opt}
                isSelected={answers.get(currentStep) === opt.label}
                onClick={() => handleSelect(opt.label)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Navigation for multi-question */}
      {!isSingleQuestion && (
        <div className="flex items-center justify-between px-3.5 py-2 border-t border-border">
          <button
            type="button"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep(currentStep - 1)}
            className="flex items-center gap-1 text-[13px] text-text-tertiary hover:text-text-secondary disabled:opacity-30 disabled:cursor-default transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>

          {currentStep < questions.length - 1 ? (
            <button
              type="button"
              disabled={!answers.has(currentStep)}
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex items-center gap-1 text-[13px] text-accent hover:text-accent-dim disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              disabled={answers.size < questions.length}
              onClick={handleSubmitAll}
              className="flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/25 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <Check className="h-3 w-3" />
              Submit
            </button>
          )}
        </div>
      )}
    </div>
  )

  function buildCurrentAnswers(): QuestionAnswer[] {
    return questions.map((q, i) => ({
      question: q.question,
      selectedOption: answers.get(i) ?? '',
    }))
  }
}

function OptionButton({
  option,
  isSelected,
  onClick,
}: {
  option: QuestionOption
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-all',
        isSelected
          ? 'border-accent/50 bg-accent/8 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]'
          : 'border-border-light bg-bg hover:border-accent/30 hover:bg-bg-hover',
      )}
    >
      <span className="text-[14px] text-text-primary">{option.label}</span>
      {option.description && (
        <span className="text-[13px] text-text-tertiary mt-0.5">{option.description}</span>
      )}
    </button>
  )
}
