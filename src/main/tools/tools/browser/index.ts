import type { ServerTool } from '@tanstack/ai'
import { browserClickTool } from './browser-click'
import { browserCloseTool } from './browser-close'
import { browserExtractTextTool } from './browser-extract-text'
import { browserFillFormTool } from './browser-fill-form'
import { browserNavigateTool } from './browser-navigate'
import { browserScreenshotTool } from './browser-screenshot'
import { browserTypeTool } from './browser-type'
import { webFetchTool } from './web-fetch'

export const browserTools: readonly ServerTool[] = [
  webFetchTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTextTool,
  browserFillFormTool,
  browserCloseTool,
]
