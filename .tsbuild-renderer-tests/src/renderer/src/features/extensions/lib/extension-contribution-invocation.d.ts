import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker';
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
export declare function transportInvokeFailure(error: unknown): ExtensionInvokeResult;
export declare function invokeBoundExtension(entry: ExtensionContributionRegistryEntry, input: ExtensionInvokeInput): Promise<{
    readonly value: {
        readonly method: "get-scope";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.host.context";
        readonly contributionId: string;
        readonly declaredScopes: readonly ("branch" | "session" | "app" | "project")[];
    } | {
        readonly value: import("packages/extension-sdk/src").JsonValue;
        readonly key: string;
        readonly method: "get";
        readonly extensionId: string;
        readonly capability: "openwaggle.storage";
        readonly contributionId: string;
        readonly storageKind: "state" | "config";
        readonly storageScope: {
            readonly kind: "global";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        };
    } | {
        readonly value: import("packages/extension-sdk/src").JsonValue;
        readonly createdAt: number;
        readonly updatedAt: number;
        readonly key: string;
        readonly method: "set";
        readonly extensionId: string;
        readonly capability: "openwaggle.storage";
        readonly contributionId: string;
        readonly storageKind: "state" | "config";
        readonly storageScope: {
            readonly kind: "global";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        };
    } | {
        readonly key: string;
        readonly method: "delete";
        readonly deleted: true;
        readonly extensionId: string;
        readonly capability: "openwaggle.storage";
        readonly contributionId: string;
        readonly storageKind: "state" | "config";
        readonly storageScope: {
            readonly kind: "global";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        };
    } | {
        readonly keys: readonly string[];
        readonly method: "list";
        readonly extensionId: string;
        readonly capability: "openwaggle.storage";
        readonly contributionId: string;
        readonly storageKind: "state" | "config";
        readonly storageScope: {
            readonly kind: "global";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        };
    } | {
        readonly recentProjects: readonly string[];
        readonly currentBranch: {
            readonly archived: boolean;
            readonly name: string;
            readonly sessionId: string;
            readonly main: boolean;
            readonly branchId: string;
        } | null;
        readonly method: "get-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly activeProjectPath: string | null;
        readonly currentProject: {
            readonly projectPath: string;
            readonly displayName: string | null;
            readonly active: boolean;
        } | null;
        readonly currentSession: {
            readonly projectPath: string | null;
            readonly title: string;
            readonly sessionId: string;
        } | null;
        readonly modelPreferences: {
            readonly selectedModel: string;
            readonly favoriteModels: readonly string[];
            readonly enabledModels: readonly string[];
            readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
        };
    } | {
        readonly value: {
            readonly projectPath: string;
            readonly displayName: string | null;
            readonly active: boolean;
        } | null;
        readonly method: "read-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly selector: "current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences";
    } | {
        readonly value: {
            readonly sessionId: string;
            readonly title: string;
            readonly projectPath: string | null;
        } | null;
        readonly method: "read-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly selector: "current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences";
    } | {
        readonly value: {
            readonly name: string;
            readonly sessionId: string;
            readonly main: boolean;
            readonly branchId: string;
            readonly archived: boolean;
        } | null;
        readonly method: "read-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly selector: "current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences";
    } | {
        readonly value: readonly string[];
        readonly method: "read-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly selector: "current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences";
    } | {
        readonly value: {
            readonly selectedModel: string;
            readonly favoriteModels: readonly string[];
            readonly enabledModels: readonly string[];
            readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
        };
        readonly method: "read-state";
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: "openwaggle.state";
        readonly contributionId: string;
        readonly selector: "current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences";
    } | {
        readonly projectPath: string;
        readonly recentProjects: readonly string[];
        readonly method: "select-project";
        readonly extensionId: string;
        readonly capability: "openwaggle.actions";
        readonly contributionId: string;
        readonly previousProjectPath: string | null;
    } | {
        readonly settings: {
            readonly projectDisplayNames: {
                readonly [x: string]: string;
            };
            readonly modelPreferences: {
                readonly selectedModel: string;
                readonly favoriteModels: readonly string[];
                readonly enabledModels: readonly string[];
                readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
            };
        };
        readonly method: "get-settings";
        readonly extensionId: string;
        readonly capability: "openwaggle.settings";
        readonly contributionId: string;
    } | {
        readonly settings: {
            readonly projectDisplayNames: {
                readonly [x: string]: string;
            };
            readonly modelPreferences: {
                readonly selectedModel: string;
                readonly favoriteModels: readonly string[];
                readonly enabledModels: readonly string[];
                readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
            };
        };
        readonly method: "update-settings";
        readonly extensionId: string;
        readonly capability: "openwaggle.settings";
        readonly contributionId: string;
    } | {
        readonly method: "get-setting";
        readonly extensionId: string;
        readonly capability: "openwaggle.settings";
        readonly contributionId: string;
        readonly setting: {
            readonly value: {
                readonly selectedModel: string;
                readonly favoriteModels: readonly string[];
                readonly enabledModels: readonly string[];
                readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
            };
            readonly key: "model-preferences";
        } | {
            readonly projectPath: string;
            readonly value: string | null;
            readonly key: "project-display-name";
        };
    } | {
        readonly method: "update-setting";
        readonly extensionId: string;
        readonly capability: "openwaggle.settings";
        readonly contributionId: string;
        readonly setting: {
            readonly value: {
                readonly selectedModel: string;
                readonly favoriteModels: readonly string[];
                readonly enabledModels: readonly string[];
                readonly thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
            };
            readonly key: "model-preferences";
        } | {
            readonly projectPath: string;
            readonly value: string | null;
            readonly key: "project-display-name";
        };
    } | {
        readonly method: "discover-docs";
        readonly extensionId: string;
        readonly capability: "openwaggle.docs";
        readonly contributionId: string;
        readonly docs: {
            readonly generatedAt: string;
            readonly bundlePath: string;
            readonly firstPartyTopics: readonly {
                readonly title: string;
                readonly source: "openwaggle" | "pi";
                readonly group: string;
                readonly description?: string | undefined;
                readonly order: number;
                readonly path: string;
                readonly bundlePath: string;
                readonly topic: string;
                readonly section?: string | undefined;
                readonly sourcePath: string;
                readonly aliases: readonly string[];
                readonly keywords: readonly string[];
                readonly contentHash: string;
            }[];
            readonly extensionTopics: readonly {
                readonly title: string;
                readonly description?: string | undefined;
                readonly path: string;
                readonly diagnostics: readonly {
                    readonly message: string;
                    readonly code: string;
                    readonly path?: string | undefined;
                    readonly severity: "error" | "warning";
                }[];
                readonly topic: string;
                readonly aliases: readonly string[];
                readonly keywords: readonly string[];
                readonly contentHash: string | null;
                readonly localTopic: string;
                readonly provenance: {
                    readonly path: string;
                    readonly scope: {
                        readonly projectPath?: string | undefined;
                        readonly kind: "project" | "global";
                        readonly label: string;
                    };
                    readonly extensionId: string;
                    readonly extensionName: string | null;
                    readonly extensionVersion: string | null;
                    readonly packagePath: string;
                    readonly manifestPath: string;
                    readonly packageContentHash: string | null;
                    readonly trust: "unknown" | "trusted" | "untrusted";
                    readonly lifecycle: "enabled" | "disabled" | "unavailable";
                };
            }[];
            readonly diagnostics: readonly {
                readonly message: string;
                readonly code: string;
                readonly path?: string | undefined;
                readonly severity: "error" | "warning";
            }[];
        };
    } | {
        readonly method: "resolve-docs-topic";
        readonly extensionId: string;
        readonly capability: "openwaggle.docs";
        readonly contributionId: string;
        readonly resolvedTopic: {
            readonly title: string;
            readonly source: "openwaggle" | "pi";
            readonly group: string;
            readonly description?: string | undefined;
            readonly order: number;
            readonly path: string;
            readonly bundlePath: string;
            readonly topic: string;
            readonly section?: string | undefined;
            readonly sourcePath: string;
            readonly aliases: readonly string[];
            readonly keywords: readonly string[];
            readonly contentHash: string;
        } | null;
    } | {
        readonly method: "register-contribution";
        readonly extensionId: string;
        readonly family: "commands" | "slashCommands" | "routes" | "settingsSections" | "sidePanels" | "dialogs" | "transcriptRenderers" | "toolRenderers" | "customMessageRenderers" | "interactionRenderers" | "statusWidgets";
        readonly capability: "openwaggle.runtime";
        readonly contributionId: string;
        readonly registeredContributionId: string;
    } | {
        readonly method: "unregister-contribution";
        readonly extensionId: string;
        readonly family: "commands" | "slashCommands" | "routes" | "settingsSections" | "sidePanels" | "dialogs" | "transcriptRenderers" | "toolRenderers" | "customMessageRenderers" | "interactionRenderers" | "statusWidgets";
        readonly capability: "openwaggle.runtime";
        readonly contributionId: string;
        readonly unregisteredContributionId: string;
        readonly unregistered: boolean;
    };
    readonly ok: true;
    readonly audit: {
        readonly timestamp: number;
        readonly method: string;
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: string;
        readonly contributionId: string;
        readonly outcome: "succeeded" | "rejected";
        readonly failureCode?: "invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed" | undefined;
    };
} | {
    readonly error: {
        readonly message: string;
        readonly code: "invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed";
        readonly issues?: readonly string[] | undefined;
    };
    readonly ok: false;
    readonly audit?: {
        readonly timestamp: number;
        readonly method: string;
        readonly scope: {
            readonly kind: "app";
        } | {
            readonly projectPath: string;
            readonly kind: "project";
        } | {
            readonly projectPath: string;
            readonly kind: "session";
            readonly sessionId: string;
        } | {
            readonly projectPath: string;
            readonly kind: "branch";
            readonly sessionId: string;
            readonly branchId: string;
        };
        readonly extensionId: string;
        readonly capability: string;
        readonly contributionId: string;
        readonly outcome: "succeeded" | "rejected";
        readonly failureCode?: "invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed" | undefined;
    } | undefined;
}>;
