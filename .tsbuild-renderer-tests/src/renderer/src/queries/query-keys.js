export function extensionPackagesQueryKey(projectPath) {
    return ['extensionPackages', projectPath];
}
export const queryKeys = {
    wagglePresets: (projectPath) => ['wagglePresets', projectPath],
    archivedSessions: ['archivedSessions'],
    archivedSessionBranches: ['archivedSessionBranches'],
    extensionPackages: extensionPackagesQueryKey,
    sessions: ['sessions'],
    session: (id) => ['session', id],
    skills: (projectPath) => ['skills', projectPath],
    skillPreview: (projectPath, skillId) => ['skillPreview', projectPath, skillId],
};
