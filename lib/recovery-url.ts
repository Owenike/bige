export function sanitizedRecoveryUrl(pathname: string, search: string) {
  const params = new URLSearchParams(search);

  if (params.get("mode") === "student") {
    return `${pathname}?mode=student`;
  }

  return pathname;
}
