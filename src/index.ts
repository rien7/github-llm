import { GitHubClient, GitHubError } from "./lib/github";
import { jsonResponse, methodNotAllowedResponse, usageResponse } from "./lib/http";
import { detectLanguage } from "./lib/language";
import { buildFileResponse, buildFileRangeResponse, buildRepoResponse, buildTreeResponse } from "./lib/serializers";
import { parseRoute } from "./lib/router";
import { isProbablyBinary, readLineRange, splitLines } from "./lib/text";
import type { Env, GitHubFileMetadata } from "./lib/types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowedResponse(request);
    }

    const route = parseRoute(new URL(request.url));
    if (!route.ok) {
      return route.usage
        ? usageResponse(request)
        : jsonResponse(request, { error: route.message }, 400);
    }

    if (route.kind === "usage") {
      return usageResponse(request);
    }

    if (route.kind === "search") {
      return jsonResponse(request, {
        error: "Search is not implemented in v1.",
      }, 501);
    }

    const github = new GitHubClient(env.GITHUB_TOKEN);

    try {
      if (route.kind === "repo-root") {
        const repoInfo = await github.fetchRepoInfo(route.repo);
        return jsonResponse(request, buildRepoResponse(route.repo, repoInfo));
      }

      const resolved = await github.resolveContent(
        route.repo,
        route.kind,
        route.refAndPathSegments,
      );

      if (route.kind === "tree") {
        if (!Array.isArray(resolved.metadata)) {
          return jsonResponse(request, {
            error: "Tree routes must resolve to a directory.",
          }, 404);
        }

        return jsonResponse(request, buildTreeResponse({
          repo: route.repo,
          branch: resolved.ref,
          path: resolved.repoPath,
          entries: resolved.metadata,
        }));
      }

      if (Array.isArray(resolved.metadata) || resolved.metadata.type !== "file") {
        return jsonResponse(request, {
          error: "Blob routes must resolve to a file.",
        }, 404);
      }

      const file = resolved.metadata as GitHubFileMetadata;
      const bytes = await github.fetchFileBytes(route.repo, resolved.ref, resolved.repoPath);

      if (isProbablyBinary(bytes)) {
        if (route.range) {
          return jsonResponse(request, {
            error: "Range reads are only supported for text files.",
          }, 400);
        }

        return jsonResponse(request, buildFileResponse({
          branch: resolved.ref,
          file,
          language: detectLanguage(file.path),
          size: bytes.byteLength,
          lineCount: null,
          content: null,
          isBinary: true,
        }));
      }

      const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, "\n");
      const lines = splitLines(text);

      if (route.range) {
        const ranged = readLineRange(lines, route.range.start, route.range.end);
        if (!ranged.ok) {
          return jsonResponse(request, { error: ranged.message }, 416);
        }

        return jsonResponse(request, buildFileRangeResponse({
          branch: resolved.ref,
          path: file.path,
          start: ranged.start,
          end: ranged.end,
          lineCount: lines.length,
          content: ranged.content,
        }));
      }

      return jsonResponse(request, buildFileResponse({
        branch: resolved.ref,
        file,
        language: detectLanguage(file.path),
        size: bytes.byteLength,
        lineCount: lines.length,
        content: text,
        isBinary: false,
      }));
    } catch (error) {
      if (error instanceof GitHubError) {
        return jsonResponse(request, { error: error.message }, error.status);
      }

      console.error(error);
      return jsonResponse(request, {
        error: "Unexpected internal error.",
      }, 500);
    }
  },
};
