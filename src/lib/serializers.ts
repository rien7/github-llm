import { buildGitHubStylePath } from "./paths";
import type {
  GitHubDirectoryListing,
  GitHubFileMetadata,
  RepoIdentifier,
  RepoInfo,
  TreeEntryResponse,
} from "./types";

export function buildRepoResponse(repo: RepoIdentifier, repoInfo: RepoInfo) {
  return {
    type: "repo",
    owner: repo.owner,
    repo: repo.name,
    default_branch: repoInfo.defaultBranch,
    description: repoInfo.description,
    root: buildGitHubStylePath(repo, "tree", repoInfo.defaultBranch),
    files_api: `${buildGitHubStylePath(repo, "blob", repoInfo.defaultBranch)}/{path}`,
    tree_api: `${buildGitHubStylePath(repo, "tree", repoInfo.defaultBranch)}/{path}`,
  };
}

export function buildTreeResponse(input: {
  repo: RepoIdentifier;
  branch: string;
  path: string;
  entries: GitHubDirectoryListing;
}) {
  const entries = [...input.entries]
    .sort(compareEntries)
    .map((entry): TreeEntryResponse => {
      const isDirectory = entry.type === "dir";

      return {
        type: isDirectory ? "dir" : "file",
        name: entry.name,
        path: entry.path,
        ...(typeof entry.size === "number" && !isDirectory ? { size: entry.size } : {}),
        url: buildGitHubStylePath(
          input.repo,
          isDirectory ? "tree" : "blob",
          input.branch,
          entry.path,
        ),
      };
    });

  return {
    type: "tree",
    path: input.path,
    branch: input.branch,
    entries,
  };
}

export function buildFileResponse(input: {
  branch: string;
  file: GitHubFileMetadata;
  language: string | null;
  size: number;
  lineCount: number | null;
  content: string | null;
  isBinary: boolean;
}) {
  return {
    type: "file",
    path: input.file.path,
    branch: input.branch,
    language: input.language,
    size: input.size,
    line_count: input.lineCount,
    is_binary: input.isBinary,
    content: input.content,
  };
}

export function buildFileRangeResponse(input: {
  branch: string;
  path: string;
  start: number;
  end: number;
  lineCount: number;
  content: string;
}) {
  return {
    type: "file_range",
    path: input.path,
    branch: input.branch,
    start: input.start,
    end: input.end,
    line_count: input.lineCount,
    content: input.content,
  };
}

function compareEntries(left: GitHubDirectoryListing[number], right: GitHubDirectoryListing[number]) {
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
