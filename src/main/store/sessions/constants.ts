import type { SessionFutureMode } from '@shared/types/session'
import { createLogger } from '../../logger'

export const MESSAGE_ENTRY_TYPE = 'message'
export const CUSTOM_MESSAGE_ENTRY_TYPE = 'custom_message'
export const MAIN_BRANCH_NAME = 'main'
export const STANDARD_FUTURE_MODE = 'standard' satisfies SessionFutureMode
export const DEFAULT_UI_STATE_JSON = '{}'
export const EXPANDED_NODE_IDS_DEFAULT_JSON = '[]'
export const EMPTY_INDEX = 0
export const sessionsLogger = createLogger('store/sessions')
