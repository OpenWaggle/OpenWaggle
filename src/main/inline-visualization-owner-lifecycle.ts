export function shouldPurgeVisualizationFramesForNavigation(input: {
  readonly isMainFrame: boolean
  readonly isSameDocument: boolean
}) {
  return input.isMainFrame && !input.isSameDocument
}
