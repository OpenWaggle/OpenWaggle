import { classifyErrorMessage, isAgentErrorCode, makeErrorInfo, } from '@shared/types/errors';
const lastErrorInfoMap = new Map();
export function getLastAgentErrorInfo(sessionId) {
    return lastErrorInfoMap.get(sessionId) ?? null;
}
export function clearLastAgentErrorInfo(sessionId) {
    lastErrorInfoMap.delete(sessionId);
}
export function setLastAgentErrorInfo(sessionId, error) {
    const info = error.code && isAgentErrorCode(error.code)
        ? makeErrorInfo(error.code, error.message)
        : classifyErrorMessage(error.message);
    lastErrorInfoMap.set(sessionId, info);
}
