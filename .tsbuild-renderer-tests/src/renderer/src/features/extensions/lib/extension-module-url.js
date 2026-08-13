import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
function encodePathSegment(value) {
    return encodeURIComponent(value);
}
function normalizeEntryPath(entryPath) {
    return entryPath.replaceAll(OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR, OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR);
}
function encodeRelativePath(relativePath) {
    return normalizeEntryPath(relativePath).split('/').map(encodePathSegment).join('/');
}
function encodeProjectPathsContext(projectPaths) {
    return encodePathSegment(JSON.stringify(projectPaths));
}
function encodeSessionContext(sessionId) {
    return encodePathSegment(JSON.stringify({ sessionId }));
}
export function createExtensionModuleUrl(entry) {
    if (!entry.entryPath) {
        return null;
    }
    const protocol = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL;
    const encodedPackagePath = encodePathSegment(entry.packagePath);
    const encodedContentHash = encodePathSegment(entry.contentHash);
    const encodedProjectPaths = encodeProjectPathsContext(entry.projectPaths);
    const contextSegments = entry.sessionId !== undefined
        ? [protocol.MODULE_CONTEXT_SEGMENT, encodeSessionContext(entry.sessionId)]
        : [];
    const encodedEntryPath = encodeRelativePath(entry.entryPath);
    return [
        `${protocol.SCHEME}://${protocol.HOST}${protocol.MODULE_PATH_PREFIX}`,
        encodedPackagePath,
        encodedContentHash,
        encodedProjectPaths,
        ...contextSegments,
        encodedEntryPath,
    ].join('/');
}
