import { SupportedModelId } from '@shared/types/brand';
import { DEFAULT_SETTINGS, THINKING_LEVELS, } from '@shared/types/settings';
import { includes } from '@shared/utils/validation';
import { useProviderStore } from '@/features/providers/state';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('preferences');
const SLICE_ARG_2 = 100;
const SLICE_ARG_2_VALUE_10 = 10;
function persistProjectPreference(projectPath, prefs) {
    if (projectPath) {
        api.setProjectPreferences(projectPath, prefs).catch((err) => {
            logger.warn('Failed to persist project preferences', { error: String(err) });
        });
    }
}
function appendRecentProject(paths, path) {
    const normalized = path.trim();
    if (!normalized || paths.includes(normalized))
        return paths;
    return [...paths, normalized].slice(-SLICE_ARG_2_VALUE_10);
}
async function refreshProviderModels(set, get) {
    const updatedSettings = await useProviderStore.getState().loadProviderModels(get().settings);
    if (updatedSettings)
        set({ settings: updatedSettings });
}
async function loadSettings(set, get) {
    try {
        const settings = await api.getSettings();
        set({ settings, isLoaded: false, loadError: null });
        if (settings.projectPath)
            await get().loadProjectPreferences(settings.projectPath);
        set({ isLoaded: true, loadError: null });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load settings';
        set({ isLoaded: true, loadError: message });
    }
}
async function setProjectPath(path, set, get) {
    const { settings } = get();
    const recentProjects = path
        ? appendRecentProject(settings.recentProjects, path)
        : settings.recentProjects;
    await api.updateSettings({ projectPath: path, recentProjects });
    set({ settings: { ...settings, projectPath: path, recentProjects } });
    if (path) {
        await get().loadProjectPreferences(path);
        await refreshProviderModels(set, get);
    }
}
async function setEnabledModels(models, set, get) {
    const { settings } = get();
    const enabledModels = models.map(SupportedModelId);
    const selectedModel = enabledModels.includes(settings.selectedModel)
        ? settings.selectedModel
        : (enabledModels[0] ?? DEFAULT_SETTINGS.selectedModel);
    await api.setEnabledModels(enabledModels);
    if (selectedModel !== settings.selectedModel) {
        await api.updateSettings({ selectedModel });
        persistProjectPreference(settings.projectPath, { model: selectedModel });
    }
    set({ settings: { ...settings, enabledModels, selectedModel } });
}
async function loadProjectPreferences(projectPath, set, get) {
    const prefs = await api.getProjectPreferences(projectPath);
    if (!prefs)
        return;
    const { settings } = get();
    const model = prefs.model ? SupportedModelId(prefs.model) : undefined;
    const thinkingLevel = prefs.thinkingLevel && includes(THINKING_LEVELS, prefs.thinkingLevel)
        ? prefs.thinkingLevel
        : undefined;
    if (!model && !thinkingLevel)
        return;
    const patch = {
        ...(model ? { selectedModel: model } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
    };
    await api.updateSettings(patch);
    set({ settings: { ...settings, ...patch } });
}
export function createPreferencesActions(set, get) {
    return {
        loadSettings: () => loadSettings(set, get),
        retryLoad: async () => {
            set({ loadError: null, isLoaded: false });
            await get().loadSettings();
            await refreshProviderModels(set, get);
        },
        setSelectedModel: async (model) => {
            const { settings } = get();
            await api.updateSettings({ selectedModel: model });
            set({ settings: { ...settings, selectedModel: model } });
            persistProjectPreference(settings.projectPath, { model });
        },
        toggleFavoriteModel: async (model) => {
            const trimmed = model.trim();
            if (!trimmed)
                return;
            const normalizedModel = SupportedModelId(trimmed);
            const { settings } = get();
            const isFavorite = settings.favoriteModels.includes(normalizedModel);
            const favoriteModels = isFavorite
                ? settings.favoriteModels.filter((entry) => entry !== normalizedModel)
                : [
                    normalizedModel,
                    ...settings.favoriteModels.filter((entry) => entry !== normalizedModel),
                ].slice(0, SLICE_ARG_2);
            await api.updateSettings({ favoriteModels });
            set({ settings: { ...settings, favoriteModels } });
        },
        setProjectPath: (path) => setProjectPath(path, set, get),
        pushRecentProject: async (path) => {
            const normalized = path.trim();
            if (!normalized)
                return;
            const { settings } = get();
            const recentProjects = appendRecentProject(settings.recentProjects, normalized);
            await api.updateSettings({ recentProjects });
            set({ settings: { ...settings, recentProjects } });
        },
        removeRecentProject: async (path) => {
            const { settings } = get();
            const recentProjects = settings.recentProjects.filter((project) => project !== path);
            await api.updateSettings({ recentProjects });
            set({ settings: { ...settings, recentProjects } });
        },
        setThinkingLevel: async (preset) => {
            const { settings } = get();
            await api.updateSettings({ thinkingLevel: preset });
            set({ settings: { ...settings, thinkingLevel: preset } });
            persistProjectPreference(settings.projectPath, { thinkingLevel: preset });
        },
        setDefaultSessionEnvironmentMode: async (mode) => {
            const { settings } = get();
            await api.updateSettings({ defaultSessionEnvironmentMode: mode });
            set({ settings: { ...settings, defaultSessionEnvironmentMode: mode } });
        },
        setDiffSyntaxTheme: async (theme) => {
            const { settings } = get();
            await api.updateSettings({ diffSyntaxTheme: theme });
            set({ settings: { ...settings, diffSyntaxTheme: theme } });
        },
        setDiffView: async (view) => {
            const { settings } = get();
            await api.updateSettings({ diffView: view });
            set({ settings: { ...settings, diffView: view } });
        },
        setDiffWrapLines: async (wrap) => {
            const { settings } = get();
            await api.updateSettings({ diffWrapLines: wrap });
            set({ settings: { ...settings, diffWrapLines: wrap } });
        },
        setEnabledModels: (models) => setEnabledModels(models, set, get),
        setProjectDisplayName: async (path, name) => {
            const { settings } = get();
            const projectDisplayNames = { ...settings.projectDisplayNames, [path]: name };
            await api.updateSettings({ projectDisplayNames });
            set({ settings: { ...settings, projectDisplayNames } });
        },
        clearProjectDisplayName: async (path) => {
            const { settings } = get();
            const { [path]: _ignored, ...projectDisplayNames } = settings.projectDisplayNames;
            await api.updateSettings({ projectDisplayNames });
            set({ settings: { ...settings, projectDisplayNames } });
        },
        removeProjectReferences: async (path) => {
            const { settings } = get();
            const recentProjects = settings.recentProjects.filter((projectPath) => projectPath !== path);
            const { [path]: _displayName, ...projectDisplayNames } = settings.projectDisplayNames;
            const { [path]: _skillToggles, ...skillTogglesByProject } = settings.skillTogglesByProject;
            const projectPath = settings.projectPath === path ? null : settings.projectPath;
            await api.updateSettings({
                projectPath,
                recentProjects,
                projectDisplayNames,
                skillTogglesByProject,
            });
            set({
                settings: {
                    ...settings,
                    projectPath,
                    recentProjects,
                    projectDisplayNames,
                    skillTogglesByProject,
                },
            });
        },
        loadProjectPreferences: (projectPath) => loadProjectPreferences(projectPath, set, get),
    };
}
