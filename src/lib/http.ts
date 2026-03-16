export function jsonResponse(request: Request, payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  const body = request.method === "HEAD" ? null : JSON.stringify(payload, null, 2);

  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function usageResponse(request: Request): Response {
  return jsonResponse(request, {
    type: "usage",
    message: "GitHub LLM JSON mirror",
    endpoints: [
      "/{owner}/{repo}",
      "/{owner}/{repo}/tree/{ref}",
      "/{owner}/{repo}/tree/{ref}/{path...}",
      "/{owner}/{repo}/blob/{ref}/{path...}",
      "/{owner}/{repo}/blob/{ref}/{path...}?start=100&end=200",
    ],
  });
}

export function methodNotAllowedResponse(request: Request): Response {
  return jsonResponse(request, {
    error: "Method Not Allowed",
  }, 405, {
    allow: "GET, HEAD",
  });
}
