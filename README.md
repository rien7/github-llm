# github-llm

`github-llm` is a Cloudflare Worker that mirrors GitHub repository paths under your own origin.

Its main use case is for LLMs and tools: instead of sending them to `github.com`, you can send them to this Worker and get either a simple directory listing or raw file contents back.

## Demo

Public demo:

- https://github-llm-public.zrien7.workers.dev/

Use the demo to inspect behavior, not as infrastructure for your own workflows. If you want reliability, rate-limit control, or private repo access, deploy your own Worker.

## Quick Example

Take this GitHub URL:

```text
https://github.com/rien7/github-llm/blob/main/src/index.ts
```

Replace `https://github.com` with your Worker origin and keep the rest unchanged:

```text
https://your-worker.example/rien7/github-llm/blob/main/src/index.ts
```

Result:

- `/{owner}/{repo}` and `/tree/...` return a simple HTML directory listing
- `/blob/...` returns the raw file contents

That rule is all an LLM needs:

```text
worker_url = github_url with https://github.com replaced by your Worker origin
```

## Deploy Your Own

Recommended path: use Cloudflare Workers Builds with a GitHub-connected repo, then add an optional GitHub token as a Worker secret.

### 1. Import the repository into Cloudflare Workers

In the Cloudflare dashboard:

1. Go to Workers & Pages.
2. Select Create application.
3. Select Get started next to Import a repository.
4. Select the repository you want to import.
5. Save and Deploy.

Cloudflare's docs do not require a fork. They just say to import the repository you want to build. A practical recommendation, inferred from Cloudflare's guidance to limit repository access, is:

- If you want to deploy this project as-is, import `rien7/github-llm`.
- If you want to maintain your own version, fork it first and import your fork.

This repo already contains the Worker entrypoint in [`src/index.ts`](/Users/rien7/Developer/github-llm/src/index.ts) and the Wrangler config in [`wrangler.jsonc`](/Users/rien7/Developer/github-llm/wrangler.jsonc).

### 2. Configure the optional `GITHUB_TOKEN` secret

This Worker uses the GitHub Contents API for metadata resolution.

For public repositories:

- You can run without a token.
- GitHub's `Get repository content` endpoint explicitly allows unauthenticated access for public resources.
- The main limit is GitHub REST API rate limiting: unauthenticated requests are 60 requests per hour per originating IP, while authenticated requests are typically 5,000 requests per hour.

If you want better rate limits or need private repository access:

1. Create a fine-grained personal access token in GitHub.
2. Choose repository access as narrowly as possible.
3. Use this rule:
   - If you only want public repository access, `Public repositories` is enough and you do not need to add `Contents: Read-only` just for public resources.
   - If you want access to private repositories, choose `Only select repositories` or `All repositories` for the relevant owner and grant `Contents: Read-only`.
4. Add it to your Worker as a secret named `GITHUB_TOKEN`.

In the Cloudflare dashboard:

1. Open your Worker.
2. Go to Settings.
3. Under Variables and Secrets, select Add.
4. Choose Secret.
5. Set the name to `GITHUB_TOKEN`.
6. Paste the token value.
7. Deploy the change.

CLI alternative:

```bash
npx wrangler secret put GITHUB_TOKEN
```

### 3. Deploy updates

If you are using Workers Builds, pushes to your connected repository will deploy automatically.

If you are deploying manually:

```bash
npx wrangler deploy
```

## Detailed Behavior

Supported paths:

- `/{owner}/{repo}`
- `/{owner}/{repo}/tree/{ref}`
- `/{owner}/{repo}/tree/{ref}/{path...}`
- `/{owner}/{repo}/blob/{ref}/{path...}`

Behavior:

- Repository root uses the repository default branch.
- `tree` routes return a plain HTML directory listing.
- `blob` routes return the raw file contents from `raw.githubusercontent.com`.
- Branch and tag names that contain `/` are supported by progressively resolving `ref` vs `path`.

Rendered directory HTML looks like this:

```html
Path: <a href="/rien7/github-llm/tree/main">rien7/github-llm</a>/<a href="/rien7/github-llm/tree/main/src">src</a>/

Type        Size Modified         Name
----        ---- --------         ----
dir            - -                <a href="/rien7/github-llm/tree/main">../</a>
file       13 KB 2026-03-16       <a href="/rien7/github-llm/blob/main/src/index.ts">index.ts</a>
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

Try:

```text
http://localhost:8787/rien7/github-llm
http://localhost:8787/rien7/github-llm/tree/main/src
http://localhost:8787/rien7/github-llm/blob/main/src/index.ts
```

For local development, you can create `.dev.vars` from the example file:

```bash
cp .dev.vars.example .dev.vars
```

Then set:

```dotenv
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

## Notes

- `GET` and `HEAD` are supported. Other methods return `405`.
- Public repositories can be accessed without authentication because GitHub allows unauthenticated access to public resources on the repository contents endpoint.
- The practical unauthenticated limit is 60 REST API requests per hour per originating IP. Authenticated requests are typically 5,000 per hour.
- For fine-grained PATs, `Contents: Read-only` is required when the token needs to access private repositories through the contents endpoint. It is not required just to read public resources.
- This project does not scrape GitHub HTML pages. It uses the GitHub API for metadata and `raw.githubusercontent.com` for file bytes.

## References

- Cloudflare Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Git integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
- Cloudflare secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare environment variables and dashboard flow: https://developers.cloudflare.com/workers/configuration/environment-variables/
- GitHub REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Creating a fine-grained PAT: https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token
- GitHub repository contents API: https://docs.github.com/en/rest/repos/contents
- GitHub fine-grained PAT permissions: https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens
