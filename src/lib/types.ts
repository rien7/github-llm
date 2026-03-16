export interface Env {
  GITHUB_TOKEN?: string;
}

export interface RepoIdentifier {
  owner: string;
  name: string;
}

export interface RepoInfo {
  defaultBranch: string;
  description: string | null;
}

export interface LineRange {
  start: number;
  end: number;
}

export type Route =
  | { ok: true; kind: "usage" }
  | { ok: true; kind: "search" }
  | { ok: true; kind: "repo-root"; repo: RepoIdentifier }
  | {
      ok: true;
      kind: "tree" | "blob";
      repo: RepoIdentifier;
      refAndPathSegments: string[];
      range: LineRange | null;
    }
  | { ok: false; usage?: true; message: string };

export interface GitHubFileMetadata {
  type: "file";
  name: string;
  path: string;
  size: number;
  url: string;
  html_url: string | null;
  git_url: string | null;
  download_url: string | null;
}

export interface GitHubDirectoryMetadata {
  type: "dir";
  name: string;
  path: string;
  size?: number;
  url: string;
  html_url: string | null;
  git_url: string | null;
  download_url: string | null;
}

export interface GitHubOtherMetadata {
  type: "symlink" | "submodule";
  name: string;
  path: string;
  size?: number;
  url: string;
  html_url: string | null;
  git_url: string | null;
  download_url: string | null;
}

export type GitHubEntry = GitHubFileMetadata | GitHubDirectoryMetadata | GitHubOtherMetadata;
export type GitHubDirectoryListing = GitHubEntry[];

export interface ResolvedContent {
  ref: string;
  repoPath: string;
  metadata: GitHubFileMetadata | GitHubDirectoryListing;
}

export interface TreeEntryResponse {
  type: "file" | "dir";
  name: string;
  path: string;
  url: string;
  size?: number;
}
