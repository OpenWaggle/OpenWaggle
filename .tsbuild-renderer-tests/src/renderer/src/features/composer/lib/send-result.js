import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('composer');
function isPromiseResult(value) {
    return value !== undefined;
}
export function consumeSendResult(result) {
    if (!isPromiseResult(result)) {
        return;
    }
    result.catch((error) => {
        logger.error('Composer send failed', {
            message: error instanceof Error ? error.message : String(error),
        });
    });
}
