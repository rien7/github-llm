import type {
    DecodePathnameResult,
    GitHubEntry,
    GitHubRouteParseResult,
    QueryRouteParseResult,
    RepoId,
} from "./types";

export function parseGitHubRoute(pathname: string): GitHubRouteParseResult {
    const decodedPath = safeDecodePathname(pathname);
    if (!decodedPath.ok) {
        return decodedPath;
    }

    const trimmedPath = decodedPath.value.replace(/^\/+|\/+$/g, "");
    if (!trimmedPath) {
        return { ok: false, usage: true };
    }

    const segments = trimmedPath.split("/");
    if (segments.length < 2) {
        return { ok: false, usage: true };
    }

    const [owner, repoName, mode, ...rest] = segments;
    const repo = { owner, name: repoName };

    if (!isSafePathSegment(owner) || !isSafePathSegment(repoName)) {
        return { ok: false, message: "Invalid repository path." };
    }

    if (!mode) {
        return { ok: true, kind: "repo-root", repo };
    }

    if (mode !== "tree" && mode !== "blob") {
        return { ok: false, usage: true };
    }

    if (rest.length === 0) {
        return { ok: false, message: `Missing ref after /${mode}/.` };
    }

    for (const segment of rest) {
        if (!isSafePathSegment(segment)) {
            return { ok: false, message: "Invalid repository path." };
        }
    }

    if (mode === "blob" && rest.length < 2) {
        return {
            ok: false,
            message: "Blob paths must include both ref and file path.",
        };
    }

    return {
        ok: true,
        kind: mode,
        repo,
        refAndPathSegments: rest,
    };
}

export function parseQueryRoute(url: URL): QueryRouteParseResult {
    const pathname = url.pathname.replace(/\/+$/g, "") || "/";
    if (pathname !== "/query") {
        return { ok: false, usage: true };
    }

    const repoValue = url.searchParams.get("repo")?.trim() ?? "";
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!repoValue || !query) {
        return { ok: false, usage: true };
    }

    const normalizedRepo = repoValue.replace(/^\/+|\/+$/g, "");
    const repoSegments = normalizedRepo.split("/");
    if (repoSegments.length !== 2) {
        return {
            ok: false,
            message: "The repo parameter must be in owner/repo format.",
        };
    }

    const [owner, repoName] = repoSegments;
    if (!isSafePathSegment(owner) || !isSafePathSegment(repoName)) {
        return {
            ok: false,
            message: "Invalid repo parameter. Expected owner/repo.",
        };
    }

    return {
        ok: true,
        kind: "query",
        repo: { owner, name: repoName },
        query,
    };
}

export function buildParentHref(
    repo: RepoId,
    ref: string | null,
    pathSegments: string[],
): string | null {
    if (!ref) {
        return null;
    }

    if (pathSegments.length === 0) {
        return buildRepoRootHref(repo);
    }

    const parentPath = pathSegments.slice(0, -1).join("/");
    return buildGitHubStyleHref(repo, "tree", ref, parentPath);
}

export function buildEntryHref(
    repo: RepoId,
    ref: string | null,
    repoPath: string,
    entry: GitHubEntry,
): string {
    const entryPath = repoPath ? `${repoPath}/${entry.name}` : entry.name;
    if (ref) {
        const mode = entry.type === "dir" ? "tree" : "blob";
        return buildGitHubStyleHref(repo, mode, ref, entryPath);
    }

    return mapGitHubHtmlUrlToLocalHref(entry.html_url);
}

export function buildRepoRootHref(repo: RepoId): string {
    return `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

export function buildGitHubStyleHref(
    repo: RepoId,
    mode: "tree" | "blob",
    ref: string,
    repoPath: string,
): string {
    const baseSegments = [
        encodeURIComponent(repo.owner),
        encodeURIComponent(repo.name),
        mode,
        ...ref.split("/").map((segment) => encodeURIComponent(segment)),
    ];

    if (repoPath) {
        baseSegments.push(
            ...repoPath.split("/").map((segment) => encodeURIComponent(segment)),
        );
    }

    return `/${baseSegments.join("/")}`;
}

export function encodeRepoPath(repoPath: string): string {
    if (!repoPath) {
        return "";
    }

    return repoPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function safeDecodePathname(pathname: string): DecodePathnameResult {
    try {
        return { ok: true, value: decodeURIComponent(pathname) };
    } catch {
        return { ok: false, message: "Invalid path encoding." };
    }
}

function mapGitHubHtmlUrlToLocalHref(htmlUrl?: string | null): string {
    if (!htmlUrl) {
        return "#";
    }

    try {
        return new URL(htmlUrl).pathname;
    } catch {
        return "#";
    }
}

function isSafePathSegment(segment: string | undefined): boolean {
    return (
        typeof segment === "string" &&
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("/")
    );
}
