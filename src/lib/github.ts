import type {
  GitHubDirectoryListing,
  GitHubEntry,
  RepoIdentifier,
  RepoInfo,
  ResolvedContent,
} from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "github-llm-worker",
  "X-GitHub-Api-Version": "2022-11-28",
};

const RAW_HEADERS = {
  Accept: "application/vnd.github.raw",
  "User-Agent": "github-llm-worker",
  "X-GitHub-Api-Version": "2022-11-28",
};

export class GitHubClient {
  constructor(private readonly githubToken?: string) {}

  async fetchRepoInfo(repo: RepoIdentifier): Promise<RepoInfo> {
    const response = await fetch(this.buildRepoApiUrl(repo), {
      headers: this.buildHeaders(API_HEADERS),
    });

    if (response.status === 404) {
      throw new GitHubError(404, "Repository not found.");
    }

    if (!response.ok) {
      throw await GitHubError.fromResponse(response, "GitHub repository request failed");
    }

    const payload = await response.json() as {
      default_branch?: string;
      description?: string | null;
    };

    if (!payload.default_branch) {
      throw new GitHubError(502, "GitHub did not provide a default branch.");
    }

    return {
      defaultBranch: payload.default_branch,
      description: payload.description ?? null,
    };
  }

  async resolveContent(
    repo: RepoIdentifier,
    mode: "tree" | "blob",
    refAndPathSegments: string[],
  ): Promise<ResolvedContent> {
    for (let splitIndex = refAndPathSegments.length; splitIndex >= 1; splitIndex -= 1) {
      const ref = refAndPathSegments.slice(0, splitIndex).join("/");
      const repoPath = refAndPathSegments.slice(splitIndex).join("/");

      if (mode === "blob" && !repoPath) {
        continue;
      }

      const response = await this.fetchContents(repo, repoPath, ref);
      if (response.status === 404) {
        continue;
      }

      if (!response.ok) {
        throw await GitHubError.fromResponse(response, "GitHub metadata request failed");
      }

      const metadata = await response.json() as GitHubEntry | GitHubDirectoryListing;
      const normalized = normalizeDirectoryListing(metadata);
      return {
        ref,
        repoPath,
        metadata: normalized,
      };
    }

    throw new GitHubError(404, "Resource not found.");
  }

  async fetchFileBytes(repo: RepoIdentifier, ref: string, repoPath: string): Promise<Uint8Array> {
    const response = await this.fetchContents(repo, repoPath, ref, "raw");
    if (response.status === 404) {
      throw new GitHubError(404, "File not found.");
    }

    if (!response.ok) {
      throw await GitHubError.fromResponse(response, "GitHub file request failed");
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  private fetchContents(
    repo: RepoIdentifier,
    repoPath: string,
    ref: string,
    variant: "json" | "raw" = "json",
  ): Promise<Response> {
    const url = new URL(this.buildContentsApiUrl(repo, repoPath));
    url.searchParams.set("ref", ref);

    return fetch(url, {
      headers: this.buildHeaders(variant === "raw" ? RAW_HEADERS : API_HEADERS),
    });
  }

  private buildHeaders(baseHeaders: Record<string, string>): Headers {
    const headers = new Headers(baseHeaders);
    const trimmedToken = this.githubToken?.trim();
    if (trimmedToken) {
      headers.set("Authorization", `Bearer ${trimmedToken}`);
    }

    return headers;
  }

  private buildRepoApiUrl(repo: RepoIdentifier): string {
    return `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  private buildContentsApiUrl(repo: RepoIdentifier, repoPath: string): string {
    const encodedPath = repoPath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const suffix = encodedPath ? `/${encodedPath}` : "";
    return `${this.buildRepoApiUrl(repo)}/contents${suffix}`;
  }
}

export class GitHubError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }

  static async fromResponse(response: Response, prefix: string): Promise<GitHubError> {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && remaining === "0") {
      return new GitHubError(
        502,
        "GitHub API rate limit reached. Configure the optional GITHUB_TOKEN secret to raise the limit.",
      );
    }

    let message = `${prefix} with status ${response.status}.`;

    try {
      const payload = await response.clone().json() as { message?: string };
      if (payload.message) {
        message = `${message} ${payload.message}`;
      }
    } catch {
      // Ignore non-JSON payloads.
    }

    return new GitHubError(502, message.trim());
  }
}

function normalizeDirectoryListing(metadata: GitHubEntry | GitHubDirectoryListing) {
  if (!Array.isArray(metadata)) {
    if (metadata.type !== "file") {
      throw new GitHubError(404, `Unsupported GitHub entry type: ${metadata.type}.`);
    }

    return metadata;
  }

  return metadata.filter((entry): entry is Extract<GitHubEntry, { type: "file" | "dir" }> => {
    return entry.type === "file" || entry.type === "dir";
  });
}
