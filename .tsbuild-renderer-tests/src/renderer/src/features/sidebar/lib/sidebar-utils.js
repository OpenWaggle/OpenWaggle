import { projectName } from '@/shared/lib/format';
export function groupSessionsByProject(sessions, displayNameOverrides = {}) {
    const groups = new Map();
    for (const session of sessions) {
        const key = session.projectPath ?? '__none__';
        const existing = groups.get(key);
        if (existing) {
            existing.push(session);
        }
        else {
            groups.set(key, [session]);
        }
    }
    const result = [];
    for (const [key, convs] of groups) {
        const path = key === '__none__' ? null : key;
        const displayName = key === '__none__' ? 'No project' : (displayNameOverrides[key] ?? projectName(key));
        result.push({ path, displayName, sessions: convs });
    }
    return result;
}
