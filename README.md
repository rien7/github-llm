# github-llm

`github-llm` is a Cloudflare Worker that mirrors GitHub repository paths as deterministic JSON for LLMs.

The goal is simple:

- no HTML parsing
- no default-branch guessing
- no ambiguous directory traversal

## What It Returns

The Worker exposes four structured response shapes:

1. `repo`
2. `tree`
3. `file`
4. `file_range`

This is enough for an agent to:

- bootstrap a repository
- walk directories programmatically
- read source files
- chunk large files by line range

## Endpoints

Supported paths:

- `/{owner}/{repo}`
- `/{owner}/{repo}/tree/{ref}`
- `/{owner}/{repo}/tree/{ref}/{path...}`
- `/{owner}/{repo}/blob/{ref}/{path...}`
- `/{owner}/{repo}/blob/{ref}/{path...}?start=100&end=200`

`GET` and `HEAD` are supported. Other methods return `405`.

## Response Shapes

### Repo

Request:

```text
/charlietlamb/openlogs
```

Response:

```json
{
  "type": "repo",
  "owner": "charlietlamb",
  "repo": "openlogs",
  "default_branch": "master",
  "description": "give agents access to your logs",
  "root": "/charlietlamb/openlogs/tree/master",
  "files_api": "/charlietlamb/openlogs/blob/master/{path}",
  "tree_api": "/charlietlamb/openlogs/tree/master/{path}"
}
```

Use this to:

- discover the default branch
- avoid guessing branch names
- derive stable path templates

### Tree

Request:

```text
/charlietlamb/openlogs/tree/master/packages/ol/src
```

Response:

```json
{
  "type": "tree",
  "path": "packages/ol/src",
  "branch": "master",
  "entries": [
    {
      "type": "file",
      "name": "cli.ts",
      "path": "packages/ol/src/cli.ts",
      "size": 8616,
      "url": "/charlietlamb/openlogs/blob/master/packages/ol/src/cli.ts"
    },
    {
      "type": "file",
      "name": "shared.ts",
      "path": "packages/ol/src/shared.ts",
      "size": 6953,
      "url": "/charlietlamb/openlogs/blob/master/packages/ol/src/shared.ts"
    }
  ]
}
```

Directory entries are sorted with directories first, then files.

### File

Request:

```text
/charlietlamb/openlogs/blob/master/packages/ol/src/cli.ts
```

Response:

```json
{
  "type": "file",
  "path": "packages/ol/src/cli.ts",
  "branch": "master",
  "language": "typescript",
  "size": 8616,
  "line_count": 339,
  "is_binary": false,
  "content": "..."
}
```

For binary files:

- `is_binary` is `true`
- `content` is `null`
- line ranges are rejected

### File Range

Request:

```text
/charlietlamb/openlogs/blob/master/packages/ol/src/cli.ts?start=1&end=20
```

Response:

```json
{
  "type": "file_range",
  "path": "packages/ol/src/cli.ts",
  "branch": "master",
  "start": 1,
  "end": 20,
  "line_count": 339,
  "content": "..."
}
```

`start` and `end` are 1-based and inclusive.

## Search

`/search` is intentionally not implemented in v1.

Reason:

- GitHub code search has different auth and rate-limit behavior
- stable line/snippet search results are harder to guarantee than `tree/blob`
- a real search layer likely deserves its own design instead of a thin placeholder

## Deterministic Agent Workflow

An agent can inspect a repo with a fixed sequence:

1. `GET /{owner}/{repo}`
2. `GET /{owner}/{repo}/tree/{default_branch}`
3. `GET /{owner}/{repo}/tree/{default_branch}/{path...}`
4. `GET /{owner}/{repo}/blob/{default_branch}/{path...}`
5. `GET /{owner}/{repo}/blob/{default_branch}/{path...}?start=...&end=...`

No HTML scraping is required.

## Implementation Notes

The Worker is now organized as TypeScript modules:

- [`src/index.ts`](/Users/rien7/Developer/github-llm/src/index.ts) wires the request flow
- [`src/lib/router.ts`](/Users/rien7/Developer/github-llm/src/lib/router.ts) parses repo/tree/blob/range routes
- [`src/lib/github.ts`](/Users/rien7/Developer/github-llm/src/lib/github.ts) talks to the GitHub REST API
- [`src/lib/serializers.ts`](/Users/rien7/Developer/github-llm/src/lib/serializers.ts) shapes JSON responses
- [`src/lib/text.ts`](/Users/rien7/Developer/github-llm/src/lib/text.ts) handles binary detection and line slicing

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the Worker locally:

```bash
npx wrangler dev
```

Try:

```text
http://localhost:8787/rien7/github-llm
http://localhost:8787/rien7/github-llm/tree/main/src
http://localhost:8787/rien7/github-llm/blob/main/README.md
http://localhost:8787/rien7/github-llm/blob/main/README.md?start=1&end=20
```

For local development, create `.dev.vars` from the example file if you want authenticated GitHub API access:

```bash
cp .dev.vars.example .dev.vars
```

Then set:

```dotenv
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

## Deploy

Deploy manually:

```bash
npx wrangler deploy
```

You can also import the repository into Cloudflare Workers Builds and let Git-backed deploys handle updates.

## Notes

- Public repositories work without authentication, subject to GitHub REST API rate limits.
- A `GITHUB_TOKEN` secret is recommended for better rate limits and private repository access.
- Branch and tag names that contain `/` are supported by progressively resolving `ref` vs `path`.
- `blob` file bytes are fetched through the GitHub Contents API with raw responses, so private repositories can work with an authenticated token.

## References

- Cloudflare Workers docs: https://developers.cloudflare.com/workers/
- Cloudflare Wrangler config: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare TypeScript guidance: https://developers.cloudflare.com/workers/languages/typescript/
- GitHub repository contents API: https://docs.github.com/en/rest/repos/contents
- GitHub REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
