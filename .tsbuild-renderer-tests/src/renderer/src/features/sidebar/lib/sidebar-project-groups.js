const EMPTY_UPDATED_AT = 0;
const EMPTY_CREATED_AT = 0;
function normalizedProjectPath(path) {
    const trimmed = path?.trim();
    return trimmed ? trimmed : null;
}
function sortSessions(sessions, sortMode) {
    const next = [...sessions];
    next.sort((left, right) => {
        if (sortMode === 'oldest') {
            return left.updatedAt - right.updatedAt;
        }
        if (sortMode === 'name') {
            return left.title.localeCompare(right.title);
        }
        return right.updatedAt - left.updatedAt;
    });
    return next;
}
function latestUpdatedAt(sessions) {
    return sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), EMPTY_UPDATED_AT);
}
function firstSessionCreatedAt(sessions) {
    if (sessions.length === 0) {
        return EMPTY_CREATED_AT;
    }
    return sessions.reduce((earliest, session) => Math.min(earliest, session.createdAt), Number.MAX_SAFE_INTEGER);
}
function addUniqueProjectPath(paths, path) {
    const normalized = normalizedProjectPath(path);
    if (!normalized || paths.includes(normalized)) {
        return false;
    }
    paths.push(normalized);
    return true;
}
export function buildSidebarProjectGroups({ sessions, currentProjectPath, recentProjects, sortMode, }) {
    const sessionsByProject = new Map();
    for (const session of sessions) {
        const projectPath = normalizedProjectPath(session.projectPath);
        if (!projectPath) {
            continue;
        }
        const projectSessions = sessionsByProject.get(projectPath) ?? [];
        projectSessions.push(session);
        sessionsByProject.set(projectPath, projectSessions);
    }
    const sessionProjectPaths = [...sessionsByProject.keys()].sort((left, right) => {
        const leftCreatedAt = firstSessionCreatedAt(sessionsByProject.get(left) ?? []);
        const rightCreatedAt = firstSessionCreatedAt(sessionsByProject.get(right) ?? []);
        return rightCreatedAt - leftCreatedAt;
    });
    const sessionlessProjectPaths = [];
    for (const projectPath of recentProjects) {
        if (!sessionsByProject.has(projectPath)) {
            addUniqueProjectPath(sessionlessProjectPaths, projectPath);
        }
    }
    const normalizedCurrentProjectPath = normalizedProjectPath(currentProjectPath);
    if (normalizedCurrentProjectPath && !sessionsByProject.has(normalizedCurrentProjectPath)) {
        addUniqueProjectPath(sessionlessProjectPaths, normalizedCurrentProjectPath);
    }
    const projectPaths = [...sessionProjectPaths, ...sessionlessProjectPaths];
    return {
        projects: projectPaths.map((projectPath) => {
            const projectSessions = sessionsByProject.get(projectPath) ?? [];
            return {
                projectPath,
                sessions: sortSessions(projectSessions, sortMode),
                firstSessionCreatedAt: firstSessionCreatedAt(projectSessions),
                latestUpdatedAt: latestUpdatedAt(projectSessions),
            };
        }),
    };
}
