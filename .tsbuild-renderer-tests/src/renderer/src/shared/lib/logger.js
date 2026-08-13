import { env } from '@/env';
const LOG_LEVEL_PRIORITIES = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function isLevelEnabled(level) {
    return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[env.logLevel];
}
export function createRendererLogger(namespace) {
    const log = (level, message, data) => {
        if (!isLevelEnabled(level)) {
            return;
        }
        const prefix = `[${namespace}] ${message}`;
        const consoleMethod = {
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        }[level];
        if (data && Object.keys(data).length > 0) {
            consoleMethod(prefix, data);
            return;
        }
        consoleMethod(prefix);
    };
    return {
        isLevelEnabled,
        isDebugEnabled() {
            return isLevelEnabled('debug');
        },
        debug(message, data) {
            log('debug', message, data);
        },
        info(message, data) {
            log('info', message, data);
        },
        warn(message, data) {
            log('warn', message, data);
        },
        error(message, data) {
            log('error', message, data);
        },
    };
}
