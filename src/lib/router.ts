import type { LineRange, RepoIdentifier, Route } from "./types";

type DecodedPathResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

type ParsedRangeResult =
  | { ok: true; value: LineRange | null }
  | { ok: false; message: string };

export function parseRoute(url: URL): Route {
  const decodedPath = safeDecodePathname(url.pathname);
  if (!decodedPath.ok) {
    return decodedPath;
  }

  const trimmedPath = decodedPath.value.replace(/^\/+|\/+$/g, "");
  if (!trimmedPath) {
    return { ok: true, kind: "usage" };
  }

  const segments = trimmedPath.split("/");
  if (segments[0] === "search") {
    return { ok: true, kind: "search" };
  }

  if (segments.length < 2) {
    return { ok: false, usage: true, message: "Usage." };
  }

  const [owner, repoName, mode, ...rest] = segments;
  const repo: RepoIdentifier = { owner, name: repoName };

  if (!isSafePathSegment(owner) || !isSafePathSegment(repoName)) {
    return { ok: false, message: "Invalid repository path." };
  }

  if (!mode) {
    return { ok: true, kind: "repo-root", repo };
  }

  if (mode !== "tree" && mode !== "blob") {
    return { ok: false, usage: true, message: "Usage." };
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

  const range = parseRange(url.searchParams, mode);
  if (!range.ok) {
    return range;
  }

  return {
    ok: true,
    kind: mode,
    repo,
    refAndPathSegments: rest,
    range: range.value,
  };
}

function parseRange(searchParams: URLSearchParams, mode: "tree" | "blob"): ParsedRangeResult {
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (start === null && end === null) {
    return { ok: true, value: null };
  }

  if (mode !== "blob") {
    return { ok: false, message: "Line ranges are only supported on blob routes." };
  }

  if (start === null || end === null) {
    return { ok: false, message: "Range reads require both start and end query parameters." };
  }

  const startNumber = parsePositiveInteger(start);
  const endNumber = parsePositiveInteger(end);
  if (startNumber === null || endNumber === null) {
    return { ok: false, message: "Range reads require positive integer start and end values." };
  }

  if (startNumber > endNumber) {
    return { ok: false, message: "Range start must be less than or equal to end." };
  }

  return {
    ok: true,
    value: {
      start: startNumber,
      end: endNumber,
    },
  };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

function safeDecodePathname(pathname: string): DecodedPathResult {
  try {
    return { ok: true, value: decodeURIComponent(pathname) };
  } catch {
    return { ok: false, message: "Invalid path encoding." };
  }
}

function isSafePathSegment(segment: string): boolean {
  return Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("/");
}
