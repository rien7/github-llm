import {
    classifyResolvedNotFound,
    enrichDirectoryEntries,
    fetchRepoMetadata,
    metadataErrorResponse,
    proxyRawFile,
    repoNotFoundResponse,
    resolveGitHubResource,
    searchRepositoryCode,
} from "./github";
import { parseGitHubRoute, parseQueryRoute } from "./routing";
import {
    isDirectoryMetadata,
    isFileMetadata,
    renderDirectoryListing,
    renderSearchResults,
    textResponse,
    usageResponse,
} from "./render";
import type { Env, GitHubMetadata, RepoId } from "./types";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return textResponse("Method Not Allowed", 405, {
                allow: "GET, HEAD",
            });
        }

        const url = new URL(request.url);
        if (url.pathname.replace(/\/+$/g, "") === "/query") {
            const queryRoute = parseQueryRoute(url);
            if (!queryRoute.ok) {
                return queryRoute.usage
                    ? usageResponse(request.url)
                    : textResponse(queryRoute.message ?? "Bad Request", 400);
            }

            const searchResponse = await searchRepositoryCode(
                queryRoute.repo,
                queryRoute.query,
                env.GITHUB_TOKEN,
            );

            return searchResponse instanceof Response
                ? searchResponse
                : renderSearchResults(searchResponse);
        }

        const route = parseGitHubRoute(url.pathname);
        if (!route.ok) {
            return route.usage
                ? usageResponse(request.url)
                : textResponse(route.message ?? "Bad Request", 400);
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
                env.GITHUB_TOKEN,
            );
        }

        const resolved = await resolveGitHubResource(
            route.repo,
            route.kind,
            route.refAndPathSegments,
            env.GITHUB_TOKEN,
        );
        if (!resolved.ok) {
            if (resolved.error === "not-found") {
                return classifyResolvedNotFound(
                    route.repo,
                    route.kind,
                    route.refAndPathSegments,
                    env.GITHUB_TOKEN,
                );
            }

            return metadataErrorResponse(resolved.response);
        }

        if (isFileMetadata(resolved.metadata)) {
            return proxyRawFile(request, resolved.metadata);
        }

        if (isDirectoryMetadata(resolved.metadata)) {
            const enrichedEntries = await enrichDirectoryEntries(
                route.repo,
                resolved.ref,
                resolved.metadata,
                env.GITHUB_TOKEN,
            );

            return renderDirectoryListing({
                repo: route.repo,
                ref: resolved.ref,
                repoPath: resolved.repoPath,
                entries: enrichedEntries,
            });
        }

        return textResponse(
            `Unsupported GitHub entry type: ${resolved.metadata.type ?? "unknown"}`,
            404,
        );
    },
} satisfies ExportedHandler<Env>;

async function handleMetadataResponse(
    request: Request,
    repo: RepoId,
    ref: string | null,
    repoPath: string,
    metadataResponse: Response,
    githubToken?: string,
): Promise<Response> {
    if (metadataResponse.status === 404) {
        const repoMissing = await repoNotFoundResponse(repo, githubToken);
        if (repoMissing) {
            return repoMissing;
        }

        return textResponse("Repository root could not be listed.", 404);
    }

    if (!metadataResponse.ok) {
        return metadataErrorResponse(metadataResponse);
    }

    const metadata = (await metadataResponse.json()) as GitHubMetadata;
    if (isDirectoryMetadata(metadata)) {
        const enrichedEntries = await enrichDirectoryEntries(
            repo,
            ref,
            metadata,
            githubToken,
        );
        return renderDirectoryListing({
            repo,
            ref,
            repoPath,
            entries: enrichedEntries,
        });
    }

    if (isFileMetadata(metadata)) {
        return proxyRawFile(request, metadata);
    }

    return textResponse(
        `Unsupported GitHub entry type: ${metadata.type ?? "unknown"}`,
        404,
    );
}
