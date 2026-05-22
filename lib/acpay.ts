import { createHash, randomBytes } from "crypto";

export type AcpayParams = Record<string, string | number | boolean | null | undefined>;
export type AcpayParsedXml = Record<string, string>;

function normalizeValue(value: string | number | boolean) {
  return String(value);
}

function escapeXml(value: string | number | boolean) {
  return normalizeValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string) {
  const withoutCdata = value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  return withoutCdata
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export function createNonceStr() {
  return randomBytes(16).toString("hex");
}

export function createOutTradeNo() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `BE${timestamp}${suffix}`.slice(0, 20);
}

export function createAcpaySign(params: AcpayParams, secretKey: string) {
  const payload = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${normalizeValue(value as string | number | boolean)}`)
    .join("&");

  return createHash("sha256")
    .update(`${payload}&key=${secretKey}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function buildAcpayXml(params: AcpayParams) {
  const body = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `<${key}>${escapeXml(value as string | number | boolean)}</${key}>`)
    .join("");

  return `<xml>${body}</xml>`;
}

export function parseAcpayXml(xml: string): AcpayParsedXml {
  const parsed: AcpayParsedXml = {};
  const content = xml.replace(/^\s*<xml>/i, "").replace(/<\/xml>\s*$/i, "");
  const tagPattern = /<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content)) !== null) {
    const key = match[1];
    parsed[key] = unescapeXml(match[2].trim());
  }

  return parsed;
}

export function verifyAcpaySign(params: AcpayParams, secretKey: string) {
  const expected = createAcpaySign(params, secretKey);
  const actual = typeof params.sign === "string" ? params.sign.toUpperCase() : "";
  return Boolean(actual) && actual === expected;
}
