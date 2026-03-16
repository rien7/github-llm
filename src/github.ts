import { encodeRepoPath } from "./routing";
import { textResponse } from "./render";
import type {
    GitHubEntry,
    GitHubMetadata,
    RepoId,
    ResolvedGitHubResource,
} from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_FILE_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const GITHUB_API_BASE_HEADERS = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-llm-worker",
    "X-GitHub-Api-Version": "2022-11-28",
} as const;

export async function resolveGitHubResource(
    repo: RepoId,
    mode: "tree" | "blob",
    refAndPathSegments: string[],
    githubToken?: string,
): Promise<ResolvedGitHubResource> {
    for (
        let splitIndex = refAndPathSegments.length;
        splitIndex >= 1;
        splitIndex -= 1
    ) {
        const ref = refAndPathSegments.slice(0, splitIndex).join("/");
        const repoPath = refAndPathSegments.slice(splitIndex).join("/");

        if (mode === "blob" && !repoPath) {
            continue;
        }

        const response = await fetchRepoMetadata(repo, repoPath, githubToken, ref);
        if (response.status === 404) {
            continue;
        }

        if (!response.ok) {
            return {
                ok: false,
                error: "github-response",
                status: response.status,
                response,
            };
        }

        const metadata = (await response.json()) as GitHubMetadata;
        return {
            ok: true,
            ref,
            repoPath,
            metadata,
        };
    }

    return { ok: false, error: "not-found" };
}

export function fetchRepoMetadata(
    repo: RepoId,
    repoPath: string,
    githubToken?: string,
    ref?: string,
): Promise<Response> {
    const encodedPath = encodeRepoPath(repoPath);
    const contentsPath = encodedPath ? `/${encodedPath}` : "";
    const metadataUrl = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents${contentsPath}`,
    );

    if (ref) {
        metadataUrl.searchParams.set("ref", ref);
    }

    return fetch(metadataUrl, {
        headers: buildGitHubApiHeaders(githubToken),
    });
}

export function proxyRawFile(
    request: Request,
    entry: GitHubEntry,
): Promise<Response> | Response {
    if (
        typeof entry.size === "number" &&
        entry.size > GITHUB_RAW_FILE_SIZE_LIMIT_BYTES
    ) {
        return textResponse(
            `File too large to mirror safely. GitHub's contents API documents a 100 MB upper limit, and this file is ${formatBytes(entry.size)}.`,
            413,
        );
    }

    if (!entry.download_url) {
        return textResponse(
            "GitHub did not provide a raw download URL for this file, so it cannot be mirrored.",
            502,
        );
    }

    return fetch(entry.download_url, {
        method: request.method,
        headers: forwardFileRequestHeaders(request.headers),
    }).then((response) => classifyRawFileResponse(response));
}

export async function metadataErrorResponse(response: Response): Promise<Response> {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && rateLimitRemaining === "0") {
        return textResponse(
            "GitHub metadata request failed with status 403 because the API rate limit was reached. Configure the optional GITHUB_TOKEN secret to raise the limit.",
            502,
        );
    }

    let message = "";
    try {
        const payload = (await response.clone().json()) as { message?: string };
        if (payload.message) {
            message = payload.message;
        }
    } catch {
        // Ignore non-JSON responses.
    }

    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes("too large")) {
        return textResponse(
            `File too large to mirror safely. GitHub metadata request reported: ${message}`,
            413,
        );
    }

    return textResponse(
        `GitHub metadata request failed with status ${response.status}.${message ? ` ${message}` : ""}`.trim(),
        502,
    );
}

export async function enrichDirectoryEntries(
    repo: RepoId,
    ref: string | null,
    entries: GitHubEntry[],
    githubToken?: string,
): Promise<GitHubEntry[]> {
    const settled = await Promise.allSettled(
        entries.map(async (entry) => ({
            ...entry,
            modifiedAt: await fetchLastModifiedAt(repo, entry.path ?? entry.name, ref, githubToken),
        })),
    );

    return settled.map((result, index) =>
        result.status === "fulfilled"
            ? result.value
            : { ...entries[index], modifiedAt: null },
    );
}

export async function repoNotFoundResponse(
    repo: RepoId,
    githubToken?: string,
): Promise<Response | null> {
    const response = await fetchRepository(repo, githubToken);
    if (response.status === 404) {
        return textResponse(
            `Repository not found or not accessible: ${repo.owner}/${repo.name}`,
            404,
        );
    }

    if (!response.ok) {
        return metadataErrorResponse(response);
    }

    return null;
}

export async function classifyResolvedNotFound(
    repo: RepoId,
    mode: "tree" | "blob",
    refAndPathSegments: string[],
    githubToken?: string,
): Promise<Response> {
    const repoMissing = await repoNotFoundResponse(repo, githubToken);
    if (repoMissing) {
        return repoMissing;
    }

    for (
        let splitIndex = refAndPathSegments.length;
        splitIndex >= 1;
        splitIndex -= 1
    ) {
        const ref = refAndPathSegments.slice(0, splitIndex).join("/");
        const repoPath = refAndPathSegments.slice(splitIndex).join("/");

        const refExists = await doesRefResolve(repo, ref, githubToken);
        if (!refExists) {
            continue;
        }

        if (!repoPath) {
            return textResponse(
                `Git ref exists but the requested ${mode} path is empty: ${ref}`,
                404,
            );
        }

        const kindLabel = mode === "tree" ? "Directory" : "File";
        return textResponse(
            `${kindLabel} not found at ref ${ref}: ${repoPath}`,
            404,
        );
    }

    return textResponse(
        `Git ref not found: ${refAndPathSegments.join("/")}`,
        404,
    );
}

function buildGitHubApiHeaders(githubToken?: string): Headers {
    const headers = new Headers(GITHUB_API_BASE_HEADERS);
    const trimmedToken = githubToken?.trim();
    if (trimmedToken) {
        headers.set("Authorization", `Bearer ${trimmedToken}`);
    }

    return headers;
}

function forwardFileRequestHeaders(headers: Headers): Headers {
    const forwarded = new Headers();
    for (const name of ["if-none-match", "if-modified-since", "range"]) {
        const value = headers.get(name);
        if (value) {
            forwarded.set(name, value);
        }
    }

    return forwarded;
}

async function fetchLastModifiedAt(
    repo: RepoId,
    repoPath: string,
    ref: string | null,
    githubToken?: string,
): Promise<string | null> {
    const commitsUrl = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits`,
    );
    commitsUrl.searchParams.set("path", repoPath);
    commitsUrl.searchParams.set("per_page", "1");

    if (ref) {
        commitsUrl.searchParams.set("sha", ref);
    }

    const response = await fetch(commitsUrl, {
        headers: buildGitHubApiHeaders(githubToken),
    });
    if (!response.ok) {
        return null;
    }

    const commits = (await response.json()) as Array<{
        commit?: {
            committer?: { date?: string | null };
            author?: { date?: string | null };
        };
    }>;
    const latestCommit = commits[0];

    return (
        latestCommit?.commit?.committer?.date ??
        latestCommit?.commit?.author?.date ??
        null
    );
}

function classifyRawFileResponse(response: Response): Response {
    if (response.ok) {
        return response;
    }

    if (response.status === 404) {
        return textResponse(
            "GitHub raw file download returned 404. The file does not exist at the requested ref.",
            404,
        );
    }

    if (response.status === 403) {
        return textResponse(
            "GitHub raw file download returned 403. The file may be blocked, rate-limited, or otherwise unreadable.",
            502,
        );
    }

    return textResponse(
        `GitHub raw file download failed with status ${response.status}.`,
        502,
    );
}

function fetchRepository(repo: RepoId, githubToken?: string): Promise<Response> {
    const repositoryUrl = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
    );

    return fetch(repositoryUrl, {
        headers: buildGitHubApiHeaders(githubToken),
    });
}

async function doesRefResolve(
    repo: RepoId,
    ref: string,
    githubToken?: string,
): Promise<boolean> {
    const commitUrl = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${encodeURIComponent(ref)}`,
    );
    const response = await fetch(commitUrl, {
        headers: buildGitHubApiHeaders(githubToken),
    });

    return response.ok;
}

function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const fixed = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
    return `${fixed} ${units[unitIndex]}`;
}
