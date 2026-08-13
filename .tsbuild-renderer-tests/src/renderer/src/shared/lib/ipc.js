/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 *
 * In non-Electron browser contexts (or if preload fails), window.api is absent.
 * Return a safe proxy so renderer stays mounted and surfaces actionable errors.
 */
function createMissingApiMethod(prop) {
    return (..._args) => {
        const message = `[ipc] window.api unavailable; attempted to call "${prop}". Ensure Electron main/preload have been restarted.`;
        console.error(message);
        if (prop.startsWith('on')) {
            return () => { };
        }
        return Promise.reject(new Error(message));
    };
}
function createApiProxy(base) {
    const handler = {
        get(_target, prop) {
            if (base) {
                const value = Reflect.get(base, prop);
                if (value !== undefined) {
                    return value;
                }
            }
            if (typeof prop !== 'string' ||
                prop === 'then' ||
                prop === 'toJSON' ||
                prop === 'hasAttribute') {
                return undefined;
            }
            return createMissingApiMethod(prop);
        },
    };
    return new Proxy(Object.create(null), handler);
}
export const api = createApiProxy(window.api);
