import { Route as rootRouteImport } from './routes/__root';
import { Route as SkillsRouteImport } from './routes/skills';
import { Route as SettingsRouteImport } from './routes/settings';
import { Route as ChatRouteImport } from './routes/_chat';
import { Route as ChatIndexRouteImport } from './routes/_chat.index';
import { Route as SettingsTabRouteImport } from './routes/settings.$tab';
import { Route as SessionsSessionIdRouteImport } from './routes/sessions.$sessionId';
import { Route as ExtensionsExtensionIdSplatRouteImport } from './routes/extensions.$extensionId.$';
declare const SkillsRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/skills", "/skills", "/skills", "/skills", undefined, import("@tanstack/router-core").ResolveParams<"/skills">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const SettingsRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/settings", "/settings", "/settings", "/settings", undefined, import("@tanstack/router-core").ResolveParams<"/settings">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const ChatRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "", "/", "/_chat", "/_chat", undefined, import("@tanstack/router-core").ResolveParams<"">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const ChatIndexRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "", "/", "/_chat", "/_chat", undefined, import("@tanstack/router-core").ResolveParams<"">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/", "/", "/_chat/", "/_chat/", (search: Record<string, unknown>) => import("./routes/-route-search").ChatRouteSearch, import("@tanstack/router-core").ResolveParams<"/">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const SettingsTabRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/settings", "/settings", "/settings", "/settings", undefined, import("@tanstack/router-core").ResolveParams<"/settings">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/$tab", "/settings/$tab", "/settings/$tab", "/settings/$tab", undefined, import("@tanstack/router-core").ResolveParams<"/$tab">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const SessionsSessionIdRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/sessions/$sessionId", "/sessions/$sessionId", "/sessions/$sessionId", "/sessions/$sessionId", (search: Record<string, unknown>) => import("./routes/-route-search").ChatRouteSearch, import("@tanstack/router-core").ResolveParams<"/sessions/$sessionId">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
declare const ExtensionsExtensionIdSplatRoute: import("@tanstack/router-core").Route<Register, import("@tanstack/react-router").RootRoute<Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/extensions/$extensionId/$", "/extensions/$extensionId/$", "/extensions/$extensionId/$", "/extensions/$extensionId/$", undefined, import("@tanstack/router-core").ResolveParams<"/extensions/$extensionId/$">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>;
export interface FileRoutesByFullPath {
    '/': typeof ChatIndexRoute;
    '/settings': typeof SettingsRouteWithChildren;
    '/skills': typeof SkillsRoute;
    '/sessions/$sessionId': typeof SessionsSessionIdRoute;
    '/settings/$tab': typeof SettingsTabRoute;
    '/extensions/$extensionId/$': typeof ExtensionsExtensionIdSplatRoute;
}
export interface FileRoutesByTo {
    '/settings': typeof SettingsRouteWithChildren;
    '/skills': typeof SkillsRoute;
    '/sessions/$sessionId': typeof SessionsSessionIdRoute;
    '/settings/$tab': typeof SettingsTabRoute;
    '/': typeof ChatIndexRoute;
    '/extensions/$extensionId/$': typeof ExtensionsExtensionIdSplatRoute;
}
export interface FileRoutesById {
    __root__: typeof rootRouteImport;
    '/_chat': typeof ChatRouteWithChildren;
    '/settings': typeof SettingsRouteWithChildren;
    '/skills': typeof SkillsRoute;
    '/sessions/$sessionId': typeof SessionsSessionIdRoute;
    '/settings/$tab': typeof SettingsTabRoute;
    '/_chat/': typeof ChatIndexRoute;
    '/extensions/$extensionId/$': typeof ExtensionsExtensionIdSplatRoute;
}
export interface FileRouteTypes {
    fileRoutesByFullPath: FileRoutesByFullPath;
    fullPaths: '/' | '/settings' | '/skills' | '/sessions/$sessionId' | '/settings/$tab' | '/extensions/$extensionId/$';
    fileRoutesByTo: FileRoutesByTo;
    to: '/settings' | '/skills' | '/sessions/$sessionId' | '/settings/$tab' | '/' | '/extensions/$extensionId/$';
    id: '__root__' | '/_chat' | '/settings' | '/skills' | '/sessions/$sessionId' | '/settings/$tab' | '/_chat/' | '/extensions/$extensionId/$';
    fileRoutesById: FileRoutesById;
}
export interface RootRouteChildren {
    ChatRoute: typeof ChatRouteWithChildren;
    SettingsRoute: typeof SettingsRouteWithChildren;
    SkillsRoute: typeof SkillsRoute;
    SessionsSessionIdRoute: typeof SessionsSessionIdRoute;
    ExtensionsExtensionIdSplatRoute: typeof ExtensionsExtensionIdSplatRoute;
}
declare module '@tanstack/react-router' {
    interface FileRoutesByPath {
        '/skills': {
            id: '/skills';
            path: '/skills';
            fullPath: '/skills';
            preLoaderRoute: typeof SkillsRouteImport;
            parentRoute: typeof rootRouteImport;
        };
        '/settings': {
            id: '/settings';
            path: '/settings';
            fullPath: '/settings';
            preLoaderRoute: typeof SettingsRouteImport;
            parentRoute: typeof rootRouteImport;
        };
        '/_chat': {
            id: '/_chat';
            path: '';
            fullPath: '/';
            preLoaderRoute: typeof ChatRouteImport;
            parentRoute: typeof rootRouteImport;
        };
        '/_chat/': {
            id: '/_chat/';
            path: '/';
            fullPath: '/';
            preLoaderRoute: typeof ChatIndexRouteImport;
            parentRoute: typeof ChatRoute;
        };
        '/settings/$tab': {
            id: '/settings/$tab';
            path: '/$tab';
            fullPath: '/settings/$tab';
            preLoaderRoute: typeof SettingsTabRouteImport;
            parentRoute: typeof SettingsRoute;
        };
        '/sessions/$sessionId': {
            id: '/sessions/$sessionId';
            path: '/sessions/$sessionId';
            fullPath: '/sessions/$sessionId';
            preLoaderRoute: typeof SessionsSessionIdRouteImport;
            parentRoute: typeof rootRouteImport;
        };
        '/extensions/$extensionId/$': {
            id: '/extensions/$extensionId/$';
            path: '/extensions/$extensionId/$';
            fullPath: '/extensions/$extensionId/$';
            preLoaderRoute: typeof ExtensionsExtensionIdSplatRouteImport;
            parentRoute: typeof rootRouteImport;
        };
    }
}
interface ChatRouteChildren {
    ChatIndexRoute: typeof ChatIndexRoute;
}
declare const ChatRouteChildren: ChatRouteChildren;
declare const ChatRouteWithChildren: import("@tanstack/router-core").Route<import("@tanstack/react-router").Register, import("@tanstack/react-router").RootRoute<import("@tanstack/react-router").Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "", "/", "/_chat", "/_chat", undefined, import("@tanstack/router-core").ResolveParams<"">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, ChatRouteChildren, unknown, unknown, unknown, undefined>;
interface SettingsRouteChildren {
    SettingsTabRoute: typeof SettingsTabRoute;
}
declare const SettingsRouteChildren: SettingsRouteChildren;
declare const SettingsRouteWithChildren: import("@tanstack/router-core").Route<import("@tanstack/react-router").Register, import("@tanstack/react-router").RootRoute<import("@tanstack/react-router").Register, undefined, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/settings", "/settings", "/settings", "/settings", undefined, import("@tanstack/router-core").ResolveParams<"/settings">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, SettingsRouteChildren, unknown, unknown, unknown, undefined>;
export declare const routeTree: import("@tanstack/router-core").Route<import("@tanstack/react-router").Register, any, "/", "/", string, "__root__", undefined, {}, import("./router-context").OpenWaggleRouterContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, RootRouteChildren, FileRouteTypes, unknown, unknown, undefined>;
export {};
