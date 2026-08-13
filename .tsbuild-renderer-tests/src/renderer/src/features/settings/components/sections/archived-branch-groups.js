export function groupArchivedBranchesByProject(sessions) {
    const groups = new Map();
    for (const session of sessions) {
        const key = session.projectPath ?? '__none__';
        const group = groups.get(key);
        if (group) {
            groups.set(key, { ...group, sessions: [...group.sessions, session] });
        }
        else {
            groups.set(key, { path: session.projectPath, sessions: [session] });
        }
    }
    return Array.from(groups.values());
}
