# github-llm

A Cloudflare Worker that mirrors GitHub repository paths under your own origin.

Example:

- `https://your-worker.example/rien7/github-llm`
- `https://your-worker.example/rien7/github-llm/tree/main/src`
- `https://your-worker.example/rien7/github-llm/blob/main/src/index.mjs`

Directory paths return a simple HTML tree. File paths return the raw file contents from `raw.githubusercontent.com`.

## How It Works

This Worker accepts GitHub-style paths directly in the request URL:

- `/{owner}/{repo}`
- `/{owner}/{repo}/tree/{ref}`
- `/{owner}/{repo}/tree/{ref}/{path...}`
- `/{owner}/{repo}/blob/{ref}/{path...}`

Behavior:

- Repository root and `tree` paths call the GitHub Contents API and render a plain HTML listing.
- `blob` paths resolve the file through the GitHub Contents API, then proxy the returned `download_url`.
- Branch and tag names that contain `/` are supported by progressively resolving `ref` vs `path`.

Rendered directory HTML looks like this:

```html
./src/
<a href="/rien7/github-llm/tree/main">../</a>
| <a href="/rien7/github-llm/blob/main/src/index.mjs">index.mjs</a>
```

## Routes

### Repository Root

`/{owner}/{repo}`

Uses the repository default branch root directory.

Example:

```text
/rien7/github-llm
```

### Directory

`/{owner}/{repo}/tree/{ref}/{path...}`

Example:

```text
/rien7/github-llm/tree/main/src
```

### File

`/{owner}/{repo}/blob/{ref}/{path...}`

Example:

```text
/rien7/github-llm/blob/main/src/index.mjs
```

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the Worker locally:

```bash
npx wrangler dev
```

The local dev server usually runs at:

```text
http://localhost:8787
```

Try:

```text
http://localhost:8787/rien7/github-llm
http://localhost:8787/rien7/github-llm/tree/main/src
http://localhost:8787/rien7/github-llm/blob/main/src/index.mjs
```

## GitHub Token

Directory and file resolution use the GitHub Contents API. Public unauthenticated requests are rate-limited, so configuring a token is recommended.

Minimum GitHub fine-grained PAT permission:

- `Contents: Read-only`

For local development, create `.dev.vars` from the example file:

```bash
cp .dev.vars.example .dev.vars
```

Then set:

```dotenv
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

For deployed Workers, add the secret with Wrangler:

```bash
npx wrangler secret put GITHUB_TOKEN
```

## Deploy

Deploy with Wrangler:

```bash
npx wrangler deploy
```

The Worker entry point is configured in [`wrangler.jsonc`](/Users/rien7/Developer/github-llm/wrangler.jsonc) and points to [`src/index.mjs`](/Users/rien7/Developer/github-llm/src/index.mjs).

## Notes

- `GET` and `HEAD` are supported. Other methods return `405`.
- If GitHub API rate limits are hit, directory resolution can fail until the limit resets or a token is configured.
- This project does not scrape GitHub HTML pages. It uses the GitHub API for metadata and `raw.githubusercontent.com` for file bytes.

## References

- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Wrangler secret command: https://developers.cloudflare.com/workers/wrangler/commands/#secret-put
