import { isRecord } from '@shared/utils/validation';
import { stringArray } from './extension-frame-bootstrap-json';
function isAudit(value) {
    return (isRecord(value) &&
        typeof value.extensionId === 'string' &&
        typeof value.contributionId === 'string' &&
        typeof value.capability === 'string' &&
        typeof value.method === 'string' &&
        isRecord(value.scope) &&
        typeof value.outcome === 'string' &&
        typeof value.timestamp === 'number' &&
        (value.failureCode === undefined || typeof value.failureCode === 'string'));
}
function isInvokeFailure(value) {
    if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
        return false;
    }
    return (typeof value.error.code === 'string' &&
        typeof value.error.message === 'string' &&
        (value.error.issues === undefined || stringArray(value.error.issues)) &&
        (value.audit === undefined || isAudit(value.audit)));
}
export function isInvokeResult(value) {
    if (isInvokeFailure(value)) {
        return true;
    }
    return isRecord(value) && value.ok === true && isAudit(value.audit) && isRecord(value.value);
}
