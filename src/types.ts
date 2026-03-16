export interface Env {
    GITHUB_TOKEN?: string;
}

export interface RepoId {
    owner: string;
    name: string;
}

export type GitHubRouteKind = "repo-root" | "tree" | "blob";

export interface GitHubEntry {
    name: string;
    type: string;
    path?: string;
    size?: number;
    html_url?: string | null;
    download_url?: string | null;
    modifiedAt?: string | null;
}

export interface GitHubObjectMetadata {
    type?: string;
    name?: string;
    html_url?: string | null;
    download_url?: string | null;
}

export type GitHubMetadata = GitHubObjectMetadata | GitHubEntry[];

export interface RenderDirectoryListingArgs {
    repo: RepoId;
    ref: string | null;
    repoPath: string;
    entries: GitHubEntry[];
}

export interface RepoRootRoute {
    ok: true;
    kind: "repo-root";
    repo: RepoId;
}

export interface ResourceRoute {
    ok: true;
    kind: "tree" | "blob";
    repo: RepoId;
    refAndPathSegments: string[];
}

export interface RouteError {
    ok: false;
    usage?: true;
    message?: string;
}

export type ParsedGitHubRoute = RepoRootRoute | ResourceRoute;
export type GitHubRouteParseResult = ParsedGitHubRoute | RouteError;

export interface DecodedPathname {
    ok: true;
    value: string;
}

export interface PathnameDecodeError {
    ok: false;
    message: string;
}

export type DecodePathnameResult = DecodedPathname | PathnameDecodeError;

export interface ResolvedGitHubResourceSuccess {
    ok: true;
    ref: string;
    repoPath: string;
    metadata: GitHubMetadata;
}

export interface ResolvedGitHubResourceNotFound {
    ok: false;
    error: "not-found";
}

export interface ResolvedGitHubResourceFailure {
    ok: false;
    error: "github-response";
    status: number;
    response: Response;
}

export type ResolvedGitHubResource =
    | ResolvedGitHubResourceSuccess
    | ResolvedGitHubResourceNotFound
    | ResolvedGitHubResourceFailure;
