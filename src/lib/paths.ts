import type { RepoIdentifier } from "./types";

export function buildRepoRootPath(repo: RepoIdentifier): string {
  return `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

export function buildGitHubStylePath(
  repo: RepoIdentifier,
  mode: "tree" | "blob",
  ref: string,
  repoPath?: string,
): string {
  const segments = [
    encodeURIComponent(repo.owner),
    encodeURIComponent(repo.name),
    mode,
    ...ref.split("/").map((segment) => encodeURIComponent(segment)),
  ];

  if (repoPath) {
    segments.push(...repoPath.split("/").map((segment) => encodeURIComponent(segment)));
  }

  return `/${segments.join("/")}`;
}
