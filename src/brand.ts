const MAX_BRAND_NAME_LENGTH = 64;

function configuredName(environmentKey: string, fallback: string): string {
  const configured = process.env[environmentKey]?.trim();
  if (!configured || configured.length > MAX_BRAND_NAME_LENGTH) return fallback;
  return (
    Array.from(configured, (character) =>
      /[\u0000-\u001f\u007f]/.test(character) ? " " : character,
    )
      .join("")
      .trim() || fallback
  );
}

export function brandText(value: string): string {
  const appName = configuredName("APP_BRAND_NAME", "Notes");
  const boardName = configuredName("BOARD_BRAND_NAME", "Boards");
  const appToken = "\u0001APP_BRAND\u0001";
  const boardToken = "\u0001BOARD_BRAND\u0001";

  return value
    .replaceAll("{{appBrandName}}", appToken)
    .replaceAll("{{boardBrandName}}", boardToken)
    .replaceAll(/\bApplication\b/g, appToken)
    .replaceAll(/\bBoard\b/g, boardToken)
    .replaceAll(appToken, appName)
    .replaceAll(boardToken, boardName);
}
