const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  h: "c",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  mjs: "javascript",
  md: "markdown",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  svg: "svg",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const SPECIAL_FILENAMES: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

export function detectLanguage(path: string): string | null {
  const fileName = path.split("/").at(-1) ?? path;
  if (SPECIAL_FILENAMES[fileName]) {
    return SPECIAL_FILENAMES[fileName];
  }

  const extension = fileName.includes(".")
    ? fileName.split(".").at(-1)?.toLowerCase()
    : null;

  if (!extension) {
    return null;
  }

  return EXTENSION_TO_LANGUAGE[extension] ?? null;
}
