const HTML_RESPONSE_PATTERN = /<!doctype|<html\b|<head\b|<body\b|<script\b|<style\b|<\/?[a-z][^>]*>/i;

export const USER_FACING_ERROR_MAX_LENGTH = 180;

export function userFacingErrorMessage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const message = value.replace(/\s+/g, " ").trim();
  if (!message || message.length > USER_FACING_ERROR_MAX_LENGTH || HTML_RESPONSE_PATTERN.test(message)) {
    return fallback;
  }
  return message;
}

export function externalErrorLogContext(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawMessage = typeof record.message === "string"
    ? record.message
    : value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  const message = rawMessage.replace(/\s+/g, " ").trim();
  const isHtmlResponse = HTML_RESPONSE_PATTERN.test(message);

  return {
    name: typeof record.name === "string" ? record.name.slice(0, 80) : undefined,
    code: typeof record.code === "string" ? record.code.slice(0, 80) : undefined,
    status: typeof record.status === "number" || typeof record.status === "string" ? record.status : undefined,
    responseFormat: isHtmlResponse ? "html" : message ? "text" : "unknown",
    messagePreview: message && !isHtmlResponse ? message.slice(0, USER_FACING_ERROR_MAX_LENGTH) : undefined,
    truncated: message.length > USER_FACING_ERROR_MAX_LENGTH,
  };
}
