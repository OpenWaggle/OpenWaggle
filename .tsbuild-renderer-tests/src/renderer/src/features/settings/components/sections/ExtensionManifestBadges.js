import { jsxs as _jsxs } from "react/jsx-runtime";
export function ManifestBadges({ extensionPackage, }) {
    const manifest = extensionPackage.manifest;
    if (!manifest) {
        return null;
    }
    return (_jsxs("div", { className: "mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted", children: [_jsxs("span", { children: [manifest.sourceFileCount, " source files"] }), _jsxs("span", { children: [manifest.builtArtifactCount, " artifacts"] }), _jsxs("span", { children: [manifest.capabilityCount, " capabilities"] }), _jsxs("span", { children: [manifest.piResourceRootCount, " Pi resource roots"] }), _jsxs("span", { children: [manifest.runtimeRequirementCount, " runtime requirements"] }), extensionPackage.buildPlan ? (_jsxs("span", { children: [extensionPackage.buildPlan.outputCount, " build outputs"] })) : null] }));
}
