const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_BASE_HEADERS = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-llm-worker",
    "X-GitHub-Api-Version": "2022-11-28",
};

export default {
    async fetch(request, env) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return textResponse("Method Not Allowed", 405, {
                allow: "GET, HEAD",
            });
        }

        const route = parseGitHubRoute(new URL(request.url).pathname);
        if (!route.ok) {
            return route.usage
                ? usageResponse(request.url)
                : textResponse(route.message, 400);
        }

        if (route.kind === "repo-root") {
            const metadataResponse = await fetchRepoMetadata(
                route.repo,
                "",
                env.GITHUB_TOKEN,
            );
            return handleMetadataResponse(
                request,
                route.repo,
                null,
                "",
                metadataResponse,
            );
        }

        const resolved = await resolveGitHubResource(
            route.repo,
            route.kind,
            route.refAndPathSegments,
            env.GITHUB_TOKEN,
        );
        if (!resolved.ok) {
            if (resolved.status === 404) {
                return textResponse("Not Found", 404);
            }

            return metadataErrorResponse(resolved.response);
        }

        if (resolved.metadata.type === "file") {
            return proxyRawFile(request, resolved.metadata.download_url);
        }

        return renderDirectoryListing({
            repo: route.repo,
            ref: resolved.ref,
            repoPath: resolved.repoPath,
            entries: resolved.metadata,
        });
    },
};

function parseGitHubRoute(pathname) {
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

async function resolveGitHubResource(
    repo,
    mode,
    refAndPathSegments,
    githubToken,
) {
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

        const response = await fetchRepoMetadata(
            repo,
            repoPath,
            githubToken,
            ref,
        );
        if (response.status === 404) {
            continue;
        }

        if (!response.ok) {
            return { ok: false, status: response.status, response };
        }

        const metadata = await response.json();
        return {
            ok: true,
            ref,
            repoPath,
            metadata,
        };
    }

    return { ok: false, status: 404 };
}

async function handleMetadataResponse(
    request,
    repo,
    ref,
    repoPath,
    metadataResponse,
) {
    if (metadataResponse.status === 404) {
        return textResponse("Not Found", 404);
    }

    if (!metadataResponse.ok) {
        return metadataErrorResponse(metadataResponse);
    }

    const metadata = await metadataResponse.json();
    if (Array.isArray(metadata)) {
        return renderDirectoryListing({
            repo,
            ref,
            repoPath,
            entries: metadata,
        });
    }

    if (metadata.type === "file") {
        return proxyRawFile(request, metadata.download_url);
    }

    return textResponse(
        `Unsupported GitHub entry type: ${metadata.type ?? "unknown"}`,
        404,
    );
}

function fetchRepoMetadata(repo, repoPath, githubToken, ref) {
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

function buildGitHubApiHeaders(githubToken) {
    const headers = new Headers(GITHUB_API_BASE_HEADERS);
    const trimmedToken = githubToken?.trim();
    if (trimmedToken) {
        headers.set("Authorization", `Bearer ${trimmedToken}`);
    }

    return headers;
}

function renderDirectoryListing({ repo, ref, repoPath, entries }) {
    const pathSegments = repoPath ? repoPath.split("/") : [];
    const currentLabel = pathSegments.length === 0 ? "./" : `./${repoPath}/`;
    const sortedEntries = [...entries].sort(compareEntries);
    const lines = [escapeHtml(currentLabel)];
    const parentHref = buildParentHref(repo, ref, pathSegments);

    if (parentHref) {
        lines.push(`<a href="${parentHref}">../</a>`);
    }

    for (const entry of sortedEntries) {
        const href = buildEntryHref(repo, ref, repoPath, entry);
        const label = `${escapeHtml(entry.name)}${entry.type === "dir" ? "/" : ""}`;
        lines.push(`| <a href="${href}">${label}</a>`);
    }

    const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark">
		<title>${escapeHtml(currentLabel)}</title>
	</head>
	<body>
		<pre>${lines.join("\n")}</pre>
	</body>
</html>`;

    return new Response(html, {
        headers: {
            "content-type": "text/html; charset=utf-8",
        },
    });
}

function buildParentHref(repo, ref, pathSegments) {
    if (!ref) {
        return null;
    }

    if (pathSegments.length === 0) {
        return buildRepoRootHref(repo);
    }

    const parentPath = pathSegments.slice(0, -1).join("/");
    return buildGitHubStyleHref(repo, "tree", ref, parentPath);
}

function buildEntryHref(repo, ref, repoPath, entry) {
    const entryPath = repoPath ? `${repoPath}/${entry.name}` : entry.name;
    if (ref) {
        const mode = entry.type === "dir" ? "tree" : "blob";
        return buildGitHubStyleHref(repo, mode, ref, entryPath);
    }

    return mapGitHubHtmlUrlToLocalHref(entry.html_url);
}

function buildRepoRootHref(repo) {
    return `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function buildGitHubStyleHref(repo, mode, ref, repoPath) {
    const baseSegments = [
        encodeURIComponent(repo.owner),
        encodeURIComponent(repo.name),
        mode,
        ...ref.split("/").map((segment) => encodeURIComponent(segment)),
    ];

    if (repoPath) {
        baseSegments.push(
            ...repoPath
                .split("/")
                .map((segment) => encodeURIComponent(segment)),
        );
    }

    return `/${baseSegments.join("/")}`;
}

function mapGitHubHtmlUrlToLocalHref(htmlUrl) {
    if (!htmlUrl) {
        return "#";
    }

    try {
        return new URL(htmlUrl).pathname;
    } catch {
        return "#";
    }
}

function compareEntries(left, right) {
    if (left.type === "dir" && right.type !== "dir") {
        return -1;
    }

    if (left.type !== "dir" && right.type === "dir") {
        return 1;
    }

    return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

function safeDecodePathname(pathname) {
    try {
        return { ok: true, value: decodeURIComponent(pathname) };
    } catch {
        return { ok: false, message: "Invalid path encoding." };
    }
}

function isSafePathSegment(segment) {
    return (
        Boolean(segment) &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("/")
    );
}

function encodeRepoPath(repoPath) {
    if (!repoPath) {
        return "";
    }

    return repoPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function proxyRawFile(request, downloadUrl) {
    if (!downloadUrl) {
        return textResponse(
            "GitHub did not provide a raw download URL for this file.",
            502,
        );
    }

    return fetch(downloadUrl, {
        method: request.method,
        headers: forwardFileRequestHeaders(request.headers),
    });
}

function forwardFileRequestHeaders(headers) {
    const forwarded = new Headers();
    for (const name of ["if-none-match", "if-modified-since", "range"]) {
        const value = headers.get(name);
        if (value) {
            forwarded.set(name, value);
        }
    }

    return forwarded;
}

async function metadataErrorResponse(response) {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && rateLimitRemaining === "0") {
        return textResponse(
            "GitHub metadata request failed with status 403 because the API rate limit was reached. Configure the optional GITHUB_TOKEN secret to raise the limit.",
            502,
        );
    }

    let details = "";
    try {
        const payload = await response.clone().json();
        if (payload?.message) {
            details = ` ${payload.message}`;
        }
    } catch {
        // Ignore non-JSON responses.
    }

    return textResponse(
        `GitHub metadata request failed with status ${response.status}.${details}`.trim(),
        502,
    );
}

function usageResponse(requestUrl) {
    const origin = new URL(requestUrl).origin;
    const examples = [
        `${origin}/rien7/github-llm`,
        `${origin}/rien7/github-llm/tree/main/src`,
        `${origin}/rien7/github-llm/blob/main/src/index.mjs`,
        `${origin}/rien7/github-llm/blob/main/README.md`,
    ];

    const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark">
		<title>GitHub Path Mirror</title>
	</head>
	<body>
		<pre>GitHub Path Mirror

This origin mirrors GitHub repository paths.
Take a GitHub URL path and append it after this origin.

Rule:
1. Replace https://github.com with ${origin}
2. Keep the remaining path unchanged

Supported paths:
- /{owner}/{repo}
- /{owner}/{repo}/tree/{ref}
- /{owner}/{repo}/tree/{ref}/{path...}
- /{owner}/{repo}/blob/{ref}/{path...}

What you get back:
- repo root and /tree/... return an HTML directory listing
- /blob/... returns the raw file contents

Examples:
| <a href="${examples[0]}">${examples[0]}</a>
| <a href="${examples[1]}">${examples[1]}</a>
| <a href="${examples[2]}">${examples[2]}</a>
| <a href="${examples[3]}">${examples[3]}</a>

LLM usage:
- To inspect a repository root, request /{owner}/{repo}
- To inspect a directory, request /{owner}/{repo}/tree/{ref}/{path...}
- To fetch a file, request /{owner}/{repo}/blob/{ref}/{path...}
- Use this origin instead of github.com when you want mirrored output from this tool</pre>
	</body>
</html>`;

    return new Response(html, {
        headers: {
            "content-type": "text/html; charset=utf-8",
        },
    });
}

function textResponse(message, status, extraHeaders = {}) {
    return new Response(message, {
        status,
        headers: {
            "content-type": "text/plain; charset=utf-8",
            ...extraHeaders,
        },
    });
}
