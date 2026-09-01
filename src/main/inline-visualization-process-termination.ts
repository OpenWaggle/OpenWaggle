import { inlineVisualizationFrameUrl } from '@shared/utils/inline-visualization'

interface FrameProcessDescriptor {
  readonly url: string
  readonly osProcessId: number
}

interface InlineVisualizationProcessTerminationInput {
  readonly frameId: string
  readonly registrationId: string
  readonly mainFrame: FrameProcessDescriptor
  readonly framesInSubtree: readonly FrameProcessDescriptor[]
  readonly isRegistered: (input: {
    readonly frameId: string
    readonly registrationId: string
  }) => boolean
  readonly killProcess?: (processId: number) => void
}

function forcefullyTerminateProcess(processId: number) {
  process.kill(processId, 'SIGKILL')
}

export function terminateInlineVisualizationFrameProcess(
  input: InlineVisualizationProcessTerminationInput,
) {
  const identity = { frameId: input.frameId, registrationId: input.registrationId }
  if (!input.isRegistered(identity)) return false

  const frameUrl = inlineVisualizationFrameUrl(input.frameId)
  const matchingFrames = input.framesInSubtree.filter((frame) => frame.url === frameUrl)
  if (matchingFrames.length !== 1) return false

  const targetProcessId = matchingFrames[0]?.osProcessId ?? 0
  if (
    !Number.isSafeInteger(targetProcessId) ||
    targetProcessId <= 0 ||
    targetProcessId === process.pid ||
    targetProcessId === input.mainFrame.osProcessId
  ) {
    return false
  }

  const framesInTargetProcess = input.framesInSubtree.filter(
    (frame) => frame.osProcessId === targetProcessId,
  )
  if (framesInTargetProcess.length !== 1 || framesInTargetProcess[0]?.url !== frameUrl) return false

  try {
    ;(input.killProcess ?? forcefullyTerminateProcess)(targetProcessId)
    return true
  } catch {
    return false
  }
}
