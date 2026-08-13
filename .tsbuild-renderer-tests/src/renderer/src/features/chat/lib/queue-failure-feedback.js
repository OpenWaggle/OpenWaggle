const AUTO_SEND_FAILURE_TOAST = 'Queued message failed to send automatically. It stayed in the queue.';
const STEER_FAILURE_TOAST = 'Could not steer the queued message. It was returned to the queue.';
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
export function reportAutoSendQueueFailure(deps, sessionId, payload, error) {
    deps.logger.error('Failed to auto-send queued message', {
        sessionId,
        error: formatError(error),
        queuedText: payload.text,
    });
    deps.showToast(AUTO_SEND_FAILURE_TOAST);
}
export function reportQueuedSteerFailure(deps, sessionId, messageId, error) {
    deps.logger.error('Failed to steer queued message', {
        sessionId,
        messageId,
        error: formatError(error),
    });
    deps.showToast(STEER_FAILURE_TOAST);
}
