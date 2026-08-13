interface WelcomeScreenProps {
    projectPath: string | null;
    hasProject: boolean;
    recentProjects: readonly string[];
    onOpenProject?: () => void;
    onSelectProjectPath?: (path: string) => Promise<void> | void;
    onRetry?: (content: string) => void;
}
export declare function WelcomeScreen({ projectPath, hasProject, recentProjects, onOpenProject, onSelectProjectPath, onRetry, }: WelcomeScreenProps): import("node_modules/@types/react").JSX.Element;
export {};
