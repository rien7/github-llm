import { encodeRepoPath } from "./routing";
import { textResponse } from "./render";
import type {
    GitHubCodeSearchItem,
    GitHubCodeSearchResponse,
    GitHubEntry,
    GitHubMetadata,
    GitHubTextMatch,
    RepoId,
    ResolvedGitHubResource,
    SearchResultLine,
    SearchResultPayload,
    SearchResultSnippet,
} from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_FILE_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const GITHUB_CODE_SEARCH_RESULT_LIMIT = 10;
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

export async function searchRepositoryCode(
    repo: RepoId,
    query: string,
    githubToken?: string,
): Promise<SearchResultPayload | Response> {
    const response = await fetchCodeSearch(repo, query, githubToken);
    if (!response.ok) {
        return searchErrorResponse(response);
    }

    const payload = (await response.json()) as GitHubCodeSearchResponse;
    const snippets = await Promise.all(
        payload.items.map((item) =>
            buildSearchResultSnippet(repo, item, query, githubToken),
        ),
    );

    return {
        repo,
        query,
        totalCount: payload.total_count,
        incompleteResults: payload.incomplete_results,
        results: snippets.filter(
            (snippet): snippet is SearchResultSnippet => snippet !== null,
        ),
    };
}

function buildGitHubApiHeaders(githubToken?: string): Headers {
    const headers = new Headers(GITHUB_API_BASE_HEADERS);
    const trimmedToken = githubToken?.trim();
    if (trimmedToken) {
        headers.set("Authorization", `Bearer ${trimmedToken}`);
    }

    return headers;
}

function buildGitHubCodeSearchHeaders(githubToken?: string): Headers {
    const headers = buildGitHubApiHeaders(githubToken);
    headers.set("Accept", "application/vnd.github.text-match+json");
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

async function fetchCodeSearch(
    repo: RepoId,
    query: string,
    githubToken?: string,
): Promise<Response> {
    const searchUrl = new URL(`${GITHUB_API_BASE}/search/code`);
    searchUrl.searchParams.set("q", `${query} repo:${repo.owner}/${repo.name}`.trim());
    searchUrl.searchParams.set("per_page", String(GITHUB_CODE_SEARCH_RESULT_LIMIT));

    return fetch(searchUrl, {
        headers: buildGitHubCodeSearchHeaders(githubToken),
    });
}

async function searchErrorResponse(response: Response): Promise<Response> {
    let message = "";
    try {
        const payload = (await response.clone().json()) as { message?: string };
        if (payload.message) {
            message = payload.message;
        }
    } catch {
        // Ignore non-JSON responses.
    }

    if (response.status === 401) {
        return textResponse(
            "GitHub code search requires an authenticated request from this Worker. Configure the GITHUB_TOKEN secret before using /query.",
            503,
        );
    }

    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && rateLimitRemaining === "0") {
        return textResponse(
            "GitHub code search rate limit reached. Retry later or configure a token with higher limits.",
            502,
        );
    }

    if (response.status === 422) {
        return textResponse(
            `GitHub code search rejected the query.${message ? ` ${message}` : ""}`.trim(),
            400,
        );
    }

    return textResponse(
        `GitHub code search failed with status ${response.status}.${message ? ` ${message}` : ""}`.trim(),
        502,
    );
}

async function buildSearchResultSnippet(
    repo: RepoId,
    item: GitHubCodeSearchItem,
    query: string,
    githubToken?: string,
): Promise<SearchResultSnippet | null> {
    const content = await fetchTextFile(item, repo, githubToken);
    if (content === null) {
        return null;
    }

    const normalizedContent = content.replaceAll("\r\n", "\n");
    const location = locateBestMatch(normalizedContent, item.text_matches, query);
    const lines = normalizedContent.split("\n");
    const targetLineIndex = location
        ? countNewlines(normalizedContent, location.matchStart)
        : findFallbackLineIndex(lines, query);
    const safeLineIndex = clamp(targetLineIndex, 0, Math.max(lines.length - 1, 0));
    const contextStart = Math.max(0, safeLineIndex - 2);
    const contextEnd = Math.min(lines.length - 1, safeLineIndex + 2);
    const snippetLines: SearchResultLine[] = [];

    for (let index = contextStart; index <= contextEnd; index += 1) {
        const lineText = lines[index] ?? "";
        let highlightStart: number | undefined;
        let highlightEnd: number | undefined;

        if (index === safeLineIndex && location) {
            const lineStartOffset = findLineStartOffset(normalizedContent, safeLineIndex);
            highlightStart = Math.max(0, location.matchStart - lineStartOffset);
            highlightEnd = Math.min(
                lineText.length,
                location.matchEnd - lineStartOffset,
            );

            if (highlightStart >= highlightEnd) {
                highlightStart = undefined;
                highlightEnd = undefined;
            }
        }

        snippetLines.push({
            lineNumber: index + 1,
            text: lineText,
            highlightStart,
            highlightEnd,
        });
    }

    return {
        path: item.path,
        htmlUrl: buildLineAnchoredHtmlUrl(item.html_url, safeLineIndex + 1),
        lineNumber: safeLineIndex + 1,
        lines: snippetLines,
    };
}

async function fetchTextFile(
    item: GitHubCodeSearchItem,
    repo: RepoId,
    githubToken?: string,
): Promise<string | null> {
    const response = item.url
        ? await fetch(item.url, {
              headers: buildGitHubApiHeaders(githubToken),
          })
        : await fetchRepoMetadata(repo, item.path, githubToken);
    if (!response.ok) {
        return null;
    }

    const payload = (await response.json()) as {
        type?: string;
        encoding?: string;
        content?: string;
    };
    if (payload.type !== "file" || payload.encoding !== "base64" || !payload.content) {
        return null;
    }

    try {
        return decodeGitHubBase64(payload.content);
    } catch {
        return null;
    }
}

function locateBestMatch(
    content: string,
    textMatches: GitHubTextMatch[] | undefined,
    query: string,
): { matchStart: number; matchEnd: number } | null {
    for (const match of textMatches ?? []) {
        if (match.property && match.property !== "content") {
            continue;
        }

        const fragment = match.fragment?.trim();
        if (fragment) {
            const fragmentIndex = content.indexOf(fragment);
            if (fragmentIndex >= 0) {
                for (const region of match.matches ?? []) {
                    if (!region.indices || region.indices.length !== 2) {
                        continue;
                    }

                    const [rawStart, rawEnd] = region.indices;
                    const indexedSlice = fragment.slice(rawStart, rawEnd);
                    const candidateText = region.text?.trim();
                    const correctedStart =
                        candidateText &&
                        indexedSlice.toLowerCase() !== candidateText.toLowerCase()
                            ? fragment.toLowerCase().indexOf(candidateText.toLowerCase())
                            : rawStart;
                    const safeStart = correctedStart >= 0 ? correctedStart : rawStart;
                    const safeEnd = safeStart + (candidateText?.length ?? Math.max(0, rawEnd - rawStart));

                    return {
                        matchStart: fragmentIndex + safeStart,
                        matchEnd: fragmentIndex + safeEnd,
                    };
                }

                return {
                    matchStart: fragmentIndex,
                    matchEnd: fragmentIndex + fragment.length,
                };
            }
        }

        for (const region of match.matches ?? []) {
            const candidateText = region.text?.trim();
            if (!candidateText) {
                continue;
            }

            const directIndex = content.indexOf(candidateText);
            if (directIndex >= 0) {
                return {
                    matchStart: directIndex,
                    matchEnd: directIndex + candidateText.length,
                };
            }

            const insensitiveIndex = content
                .toLowerCase()
                .indexOf(candidateText.toLowerCase());
            if (insensitiveIndex >= 0) {
                return {
                    matchStart: insensitiveIndex,
                    matchEnd: insensitiveIndex + candidateText.length,
                };
            }
        }

    }

    return locateQueryFallback(content, query);
}

function locateQueryFallback(
    content: string,
    query: string,
): { matchStart: number; matchEnd: number } | null {
    const lowerContent = content.toLowerCase();
    for (const term of extractSearchTerms(query)) {
        const index = lowerContent.indexOf(term.toLowerCase());
        if (index >= 0) {
            return {
                matchStart: index,
                matchEnd: index + term.length,
            };
        }
    }

    return null;
}

function extractSearchTerms(query: string): string[] {
    const quotedTerms = Array.from(
        query.matchAll(/"([^"]+)"/g),
        (match) => match[1]?.trim() ?? "",
    ).filter(Boolean);
    const bareTerms = query
        .replace(/"[^"]+"/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(
            (term) =>
                term.length > 1 &&
                !term.includes(":") &&
                !term.startsWith("-"),
        );

    return [...quotedTerms, ...bareTerms];
}

function countNewlines(content: string, offset: number): number {
    let lineIndex = 0;
    for (let index = 0; index < offset && index < content.length; index += 1) {
        if (content[index] === "\n") {
            lineIndex += 1;
        }
    }

    return lineIndex;
}

function findLineStartOffset(content: string, lineIndex: number): number {
    if (lineIndex <= 0) {
        return 0;
    }

    let currentLine = 0;
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === "\n") {
            currentLine += 1;
            if (currentLine === lineIndex) {
                return index + 1;
            }
        }
    }

    return content.length;
}

function findFallbackLineIndex(lines: string[], query: string): number {
    const loweredLines = lines.map((line) => line.toLowerCase());
    for (const term of extractSearchTerms(query)) {
        const loweredTerm = term.toLowerCase();
        const lineIndex = loweredLines.findIndex((line) => line.includes(loweredTerm));
        if (lineIndex >= 0) {
            return lineIndex;
        }
    }

    return 0;
}

function buildLineAnchoredHtmlUrl(
    htmlUrl: string | null | undefined,
    lineNumber: number,
): string {
    if (!htmlUrl) {
        return "#";
    }

    return `${htmlUrl}#L${lineNumber}`;
}

function decodeGitHubBase64(value: string): string {
    const normalized = value.replace(/\s+/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
