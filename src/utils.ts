const PATH_LIMIT = 1024;

function hasControlCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("APP_API_URL must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_API_URL must be an HTTP(S) notes service origin");
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "APP_API_URL must use HTTPS except for loopback development",
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/api") {
    throw new Error(
      "APP_API_URL must be the notes service origin, without a space path",
    );
  }
  return url.origin;
}

export function validateSpacePath(path: string): string {
  if (
    !path ||
    path.length > PATH_LIMIT ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasControlCharacter(path) ||
    path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith("."),
      )
  ) {
    throw new Error(
      "path must be a visible relative path inside the selected space",
    );
  }
  return path;
}

export function fileApiPath(path: string): string {
  return `/api/files/${validateSpacePath(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function revisionApiPath(path: string): string {
  return `/api/revisions/${validateSpacePath(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function queryString(
  values: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function textContentType(contentType: string): boolean {
  return /^(text\/|application\/(?:json|xml|javascript|yaml|x-yaml|toml))/i.test(
    contentType,
  );
}
