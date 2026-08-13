export function packageTitle(extensionPackage) {
    return extensionPackage.manifest?.name ?? extensionPackage.id;
}
export function hasErrorDiagnostics(extensionPackage) {
    return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
export function visiblePackageDiagnostics(extensionPackage) {
    return [...extensionPackage.diagnostics, ...(extensionPackage.lifecycle?.diagnostics ?? [])];
}
export function isSdkCompatible(extensionPackage) {
    return extensionPackage.sdkCompatibility?.compatible ?? false;
}
export function isBuildPlanApproved(extensionPackage) {
    return (extensionPackage.buildPlan?.approvalRequired !== true || extensionPackage.buildPlan.approved);
}
