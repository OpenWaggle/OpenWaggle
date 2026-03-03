import type { QuestionAnswer } from '@shared/types/question'
import { userQuestionSchema } from '@shared/types/question'
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { defineOpenWaggleTool } from '../define-tool'
import { cancelQuestion, registerQuestion } from '../question-manager'

const MAX_ARG_1 = 4

export const askUserTool = defineOpenWaggleTool({
  name: 'askUser',
  description:
    'Ask the user a question with clickable options. Use this only when a user preference is required to proceed and different answers lead to materially different implementation actions. Do not use for simple capability yes/no questions, terminology disambiguation, or generic taxonomy prompts. First provide a direct best-effort answer when possible. Present clear, concise questions with 2-5 options each. You can ask 1-4 questions at once.',
  needsApproval: false,
  inputSchema: z.object({
    questions: z
      .array(userQuestionSchema)
      .min(1)
      .max(MAX_ARG_1)
      .describe('Questions to present to the user (1-4)'),
  }),
  async execute(args, context) {
    const { conversationId, signal } = context

    // Emit the question event to the renderer
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:question', {
          conversationId,
          questions: args.questions,
        })
      }
    }

    // Block until the user answers or the run is aborted
    const answers = await new Promise<QuestionAnswer[]>((resolve, reject) => {
      registerQuestion(conversationId, resolve, reject)

      if (signal?.aborted) {
        cancelQuestion(conversationId)
        reject(new Error('Question cancelled'))
        return
      }

      signal?.addEventListener(
        'abort',
        () => {
          cancelQuestion(conversationId)
        },
        { once: true },
      )
    })

    return JSON.stringify({ answers })
  },
})
