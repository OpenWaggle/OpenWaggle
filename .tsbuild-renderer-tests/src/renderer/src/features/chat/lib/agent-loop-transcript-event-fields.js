import { safeDecodeUnknown } from '@shared/schema';
import { jsonValueSchema } from '@shared/schemas/validation';
export function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function stringField(value, key) {
    const field = value[key];
    return typeof field === 'string' ? field : null;
}
export function numberField(value, key) {
    const field = value[key];
    return typeof field === 'number' ? field : null;
}
export function optionalJsonValue(value) {
    if (value === undefined) {
        return undefined;
    }
    const decoded = safeDecodeUnknown(jsonValueSchema, value);
    return decoded.success ? decoded.data : undefined;
}
export function parseJsonObject(raw) {
    try {
        const parsed = JSON.parse(raw);
        return isObject(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
export function baseEventFields(event) {
    const timestamp = numberField(event, 'timestamp');
    if (timestamp === null) {
        return null;
    }
    const model = stringField(event, 'model');
    const rawEvent = optionalJsonValue(event.rawEvent);
    return {
        timestamp,
        ...(model !== null ? { model } : {}),
        ...(rawEvent !== undefined ? { rawEvent } : {}),
    };
}
