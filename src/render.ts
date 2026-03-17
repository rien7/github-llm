import {
    buildEntryHref,
    buildGitHubStyleHref,
    buildParentHref,
    buildRepoRootHref,
} from "./routing";
import type {
    GitHubEntry,
    GitHubMetadata,
    RenderDirectoryListingArgs,
} from "./types";

export function renderDirectoryListing({
    repo,
    ref,
    repoPath,
    entries,
}: RenderDirectoryListingArgs): Response {
    const pathSegments = repoPath ? repoPath.split("/") : [];
    const currentLabel = formatDirectoryLabel(repo, repoPath);
    const sortedEntries = [...entries].sort(compareEntries);
    const lines = [
        `Path: ${renderBreadcrumbPath(repo, ref, repoPath)}`,
        "",
        `${padRight("Type", 6)} ${padLeft("Size", 9)} ${padRight("Modified", 16)} Name`,
        `${padRight("----", 6)} ${padLeft("----", 9)} ${padRight("--------", 16)} ----`,
    ];
    const parentHref = buildParentHref(repo, ref, pathSegments);

    if (parentHref) {
        lines.push(formatEntryLine("dir", "-", "-", `<a href="${parentHref}">../</a>`));
    }

    for (const entry of sortedEntries) {
        const href = buildEntryHref(repo, ref, repoPath, entry);
        const label = `${escapeHtml(entry.name)}${entry.type === "dir" ? "/" : ""}`;
        lines.push(
            formatEntryLine(
                formatEntryType(entry.type),
                formatEntrySize(entry),
                formatEntryModifiedAt(entry.modifiedAt),
                `<a href="${href}">${label}</a>`,
            ),
        );
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

export function usageResponse(requestUrl: string): Response {
    const origin = new URL(requestUrl).origin;
    const examples = [
        `${origin}/rien7/github-llm`,
        `${origin}/rien7/github-llm/tree/main/src`,
        `${origin}/rien7/github-llm/blob/main/src/index.ts`,
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
<a href="${examples[0]}">${examples[0]}</a>
<a href="${examples[1]}">${examples[1]}</a>
<a href="${examples[2]}">${examples[2]}</a>
<a href="${examples[3]}">${examples[3]}</a>

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

export function textResponse(
    message: string,
    status: number,
    extraHeaders: HeadersInit = {},
): Response {
    return new Response(message, {
        status,
        headers: {
            "content-type": "text/plain; charset=utf-8",
            ...extraHeaders,
        },
    });
}

export function isDirectoryMetadata(
    metadata: GitHubMetadata,
): metadata is GitHubEntry[] {
    return Array.isArray(metadata);
}

export function isFileMetadata(metadata: GitHubMetadata): metadata is GitHubEntry {
    return (
        !Array.isArray(metadata) &&
        metadata.type === "file" &&
        typeof metadata.name === "string"
    );
}

function compareEntries(left: GitHubEntry, right: GitHubEntry): number {
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

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function formatDirectoryLabel(repo: RenderDirectoryListingArgs["repo"], repoPath: string): string {
    if (!repoPath) {
        return `${repo.owner}/${repo.name}/`;
    }

    return `${repo.owner}/${repo.name}/${repoPath}/`;
}

function renderBreadcrumbPath(
    repo: RenderDirectoryListingArgs["repo"],
    ref: string | null,
    repoPath: string,
): string {
    const rootHref = ref
        ? buildGitHubStyleHref(repo, "tree", ref, "")
        : buildRepoRootHref(repo);
    const crumbs = [
        `<a href="${rootHref}">${escapeHtml(`${repo.owner}/${repo.name}`)}</a>`,
    ];

    if (!repoPath) {
        return `${crumbs[0]}/`;
    }

    const accumulatedPath: string[] = [];
    for (const segment of repoPath.split("/")) {
        accumulatedPath.push(segment);
        const href = ref
            ? buildGitHubStyleHref(repo, "tree", ref, accumulatedPath.join("/"))
            : rootHref;
        crumbs.push(`<a href="${href}">${escapeHtml(segment)}</a>`);
    }

    return `${crumbs.join("/")}/`;
}

function formatEntryLine(
    type: string,
    size: string,
    modifiedAt: string,
    label: string,
): string {
    return `${padRight(type, 6)} ${padLeft(size, 9)} ${padRight(modifiedAt, 16)} ${label}`;
}

function formatEntryType(entryType: string): string {
    return entryType === "dir" ? "dir" : "file";
}

function formatEntrySize(entry: GitHubEntry): string {
    if (entry.type === "dir") {
        return "-";
    }

    if (typeof entry.size !== "number") {
        return "?";
    }

    return humanizeBytes(entry.size);
}

function formatEntryModifiedAt(value?: string | null): string {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
}

function humanizeBytes(bytes: number): string {
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

function padLeft(value: string, width: number): string {
    return value.padStart(width, " ");
}

function padRight(value: string, width: number): string {
    return value.padEnd(width, " ");
}
