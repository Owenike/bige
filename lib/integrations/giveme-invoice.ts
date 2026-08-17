import { createHash } from "node:crypto";

export type GivemeInvoiceMode = "test" | "production";
export type GivemeInvoiceKind = "B2C" | "B2B";

export interface GivemeInvoiceConfig {
  enabled: boolean;
  mode: GivemeInvoiceMode;
  apiRoot: string;
  uncode: string;
  idno: string;
  password: string;
  timeoutMs: number;
}

export interface GivemeOrderLineInput {
  title: string;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
}

export interface GivemeInvoiceItem {
  name: string;
  money: number;
  number: number;
  remark?: string;
}

export interface GivemeIssueInvoiceInput {
  orderId: string;
  totalFee: number;
  customerName?: string | null;
  carrier?: string | null;
  taxId?: string | null;
  email?: string | null;
  content?: string | null;
  items?: GivemeOrderLineInput[];
}

export interface GivemeProviderResponse {
  success: boolean;
  code: string;
  msg: string;
  totalFee?: string;
  orderCode?: string;
  phone?: string;
  type?: string;
  tranno?: string;
  email?: string;
  email2?: string;
  randomCode?: string;
  datetime?: string;
  status?: string;
  delRemark?: string;
  delTime?: string;
  details?: Array<Record<string, unknown>>;
  raw: Record<string, unknown> | null;
}

export interface GivemeIssueInvoiceResult extends GivemeProviderResponse {
  kind: GivemeInvoiceKind;
  request: Record<string, unknown>;
}

export interface GivemeRequestDependencies {
  config?: GivemeInvoiceConfig;
  fetcher?: typeof fetch;
  now?: Date;
}

const DEFAULT_API_ROOT = "https://www.giveme.com.tw/invoice.do";
const MOBILE_BARCODE_PATTERN = /^\/[0-9A-Z+\-.]{7}$/;

export class GivemeInvoiceError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GivemeInvoiceError";
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function readGivemeInvoiceConfig(
  env: Record<string, string | undefined> = process.env,
): GivemeInvoiceConfig {
  const mode = String(env.GIVEME_INVOICE_MODE || "test").trim().toLowerCase() === "production"
    ? "production"
    : "test";
  return {
    enabled: readEnabled(env.GIVEME_INVOICE_ENABLED),
    mode,
    apiRoot: String(env.GIVEME_INVOICE_API_ROOT || DEFAULT_API_ROOT).trim(),
    uncode: String(env.GIVEME_INVOICE_UNCODE || "").trim(),
    idno: String(env.GIVEME_INVOICE_IDNO || "").trim(),
    password: String(env.GIVEME_INVOICE_PASSWORD || ""),
    timeoutMs: readPositiveInteger(env.GIVEME_INVOICE_TIMEOUT_MS, 10_000),
  };
}

export function assertGivemeInvoiceConfig(config: GivemeInvoiceConfig) {
  if (!config.enabled) {
    throw new GivemeInvoiceError("Giveme invoice integration is disabled");
  }
  if (!config.apiRoot || !config.uncode || !config.idno || !config.password) {
    throw new GivemeInvoiceError("Giveme invoice integration is missing required configuration");
  }
  let url: URL;
  try {
    url = new URL(config.apiRoot);
  } catch {
    throw new GivemeInvoiceError("Giveme invoice API URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new GivemeInvoiceError("Giveme invoice API must use HTTPS");
  }
}

export function createGivemeInvoiceSign(timeStamp: string, idno: string, password: string) {
  return createHash("md5")
    .update(`${timeStamp}${idno}${password}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

function invoiceInteger(value: unknown, label: string) {
  const parsed = Number(value);
  const rounded = Math.round(parsed);
  if (!Number.isFinite(parsed) || rounded <= 0 || Math.abs(parsed - rounded) > 0.000001) {
    throw new GivemeInvoiceError(`${label} must be a positive whole number`);
  }
  return rounded;
}

function sanitizeItemName(value: string, fallback: string) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>"'`\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function buildGivemeInvoiceItems(
  totalFeeInput: number,
  lines: GivemeOrderLineInput[] = [],
): GivemeInvoiceItem[] {
  const totalFee = invoiceInteger(totalFeeInput, "Invoice total");
  const normalized = lines
    .map((line, index) => {
      const quantity = Number(line.quantity ?? 1);
      const unitPrice = Number(line.unitPrice ?? 0);
      const explicitTotal = Number(line.lineTotal ?? 0);
      const derivedTotal = Number.isFinite(explicitTotal) && explicitTotal > 0
        ? explicitTotal
        : unitPrice * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
      return {
        name: sanitizeItemName(line.title, `商品 ${index + 1}`),
        weight: Number.isFinite(derivedTotal) && derivedTotal > 0 ? derivedTotal : 0,
      };
    })
    .filter((line) => line.weight > 0);

  if (normalized.length === 0) {
    return [{ name: "健身服務", money: totalFee, number: 1 }];
  }

  const sourceTotal = normalized.reduce((sum, line) => sum + line.weight, 0);
  let allocated = 0;
  return normalized.map((line, index) => {
    const isLast = index === normalized.length - 1;
    const remaining = totalFee - allocated;
    const money = isLast
      ? remaining
      : Math.min(remaining, Math.max(0, Math.round((totalFee * line.weight) / sourceTotal)));
    allocated += money;
    return { name: line.name, money, number: 1 };
  });
}

export function isGivemeMobileBarcode(value: string | null | undefined) {
  return MOBILE_BARCODE_PATTERN.test(String(value || "").trim().toUpperCase());
}

function formatTaipeiDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function buildAuth(config: GivemeInvoiceConfig, now: Date) {
  const timeStamp = String(now.getTime());
  return {
    timeStamp,
    uncode: config.uncode,
    idno: config.idno,
    sign: createGivemeInvoiceSign(timeStamp, config.idno, config.password),
  };
}

function parseProviderResponse(text: string): GivemeProviderResponse {
  let raw: Record<string, unknown> | null = null;
  try {
    const parsed = text ? JSON.parse(text.replace(/^\uFEFF/, "")) : null;
    raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    raw = null;
  }
  const successValue = raw?.success;
  const success = successValue === true || String(successValue || "").toLowerCase() === "true";
  const stringValue = (key: string) => raw?.[key] == null ? "" : String(raw[key]);
  return {
    success,
    code: stringValue("code"),
    msg: stringValue("msg") || (!raw && text ? text.slice(0, 300) : ""),
    totalFee: stringValue("totalFee") || undefined,
    orderCode: stringValue("orderCode") || undefined,
    phone: stringValue("phone") || undefined,
    type: stringValue("type") || undefined,
    tranno: stringValue("tranno") || undefined,
    email: stringValue("email") || undefined,
    email2: stringValue("email2") || undefined,
    randomCode: stringValue("randomCode") || undefined,
    datetime: stringValue("datetime") || undefined,
    status: stringValue("status") || undefined,
    delRemark: stringValue("delRemark") || undefined,
    delTime: stringValue("delTime") || undefined,
    details: Array.isArray(raw?.details) ? raw.details as Array<Record<string, unknown>> : undefined,
    raw,
  };
}

async function callGiveme(
  action: string,
  request: Record<string, unknown>,
  dependencies: GivemeRequestDependencies = {},
) {
  const config = dependencies.config ?? readGivemeInvoiceConfig();
  assertGivemeInvoiceConfig(config);
  const fetcher = dependencies.fetcher ?? fetch;
  const url = new URL(config.apiRoot);
  url.searchParams.set("action", action);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetcher(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GivemeInvoiceError(
        `Giveme invoice API returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
        response.status,
      );
    }
    return parseProviderResponse(text);
  } catch (error) {
    if (error instanceof GivemeInvoiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GivemeInvoiceError("Giveme invoice API timed out");
    }
    throw new GivemeInvoiceError(
      error instanceof Error ? `Giveme invoice API request failed: ${error.message}` : "Giveme invoice API request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function buildGivemeIssueRequest(
  input: GivemeIssueInvoiceInput,
  config: GivemeInvoiceConfig,
  now = new Date(),
) {
  assertGivemeInvoiceConfig(config);
  const totalFee = invoiceInteger(input.totalFee, "Invoice total");
  const taxId = String(input.taxId || "").trim();
  if (taxId && !/^\d{8}$/.test(taxId)) {
    throw new GivemeInvoiceError("Buyer tax ID must contain exactly 8 digits");
  }
  const kind: GivemeInvoiceKind = taxId ? "B2B" : "B2C";
  const items = buildGivemeInvoiceItems(totalFee, input.items);
  const auth = buildAuth(config, now);
  const customerName = String(input.customerName || "").trim().slice(0, 100);
  const email = String(input.email || "").trim().slice(0, 200);
  const content = sanitizeItemName(input.content || "BIG E FITNESS 消費", "BIG E FITNESS 消費");
  const common = {
    ...auth,
    customerName,
    datetime: formatTaipeiDate(now),
    email,
    email2: "",
    taxType: 0,
    totalFee: String(totalFee),
    content,
    items,
  };

  if (kind === "B2B") {
    const sales = Math.round(totalFee / 1.05);
    return {
      kind,
      action: "addB2B",
      request: {
        ...common,
        phone: taxId,
        taxState: "0",
        sales: String(sales),
        amount: String(totalFee - sales),
      },
    };
  }

  const carrier = String(input.carrier || "").trim().toUpperCase();
  const mobileBarcode = isGivemeMobileBarcode(carrier) ? carrier : "";
  const fallbackOrderCode = `BIGE${input.orderId.replace(/[^0-9A-Z]/gi, "").toUpperCase()}`.slice(0, 50);
  return {
    kind,
    action: "addB2C",
    request: {
      ...common,
      phone: mobileBarcode,
      orderCode: mobileBarcode ? "" : (carrier || fallbackOrderCode),
      state: "0",
      donationCode: "",
    },
  };
}

export async function issueGivemeInvoice(
  input: GivemeIssueInvoiceInput,
  dependencies: GivemeRequestDependencies = {},
): Promise<GivemeIssueInvoiceResult> {
  const config = dependencies.config ?? readGivemeInvoiceConfig();
  const built = buildGivemeIssueRequest(input, config, dependencies.now ?? new Date());
  const response = await callGiveme(built.action, built.request, {
    ...dependencies,
    config,
  });
  return { ...response, kind: built.kind, request: built.request };
}

export async function voidGivemeInvoice(
  input: { code: string; remark: string },
  dependencies: GivemeRequestDependencies = {},
) {
  const config = dependencies.config ?? readGivemeInvoiceConfig();
  assertGivemeInvoiceConfig(config);
  const now = dependencies.now ?? new Date();
  const code = String(input.code || "").trim().toUpperCase();
  const remark = String(input.remark || "").trim().slice(0, 200);
  if (!code) throw new GivemeInvoiceError("Invoice number is required");
  if (!remark) throw new GivemeInvoiceError("Void reason is required");
  return callGiveme("cancelInvoice", {
    ...buildAuth(config, now),
    code,
    remark,
  }, { ...dependencies, config });
}

export async function queryGivemeInvoice(
  codeInput: string,
  dependencies: GivemeRequestDependencies = {},
) {
  const config = dependencies.config ?? readGivemeInvoiceConfig();
  assertGivemeInvoiceConfig(config);
  const now = dependencies.now ?? new Date();
  const code = String(codeInput || "").trim().toUpperCase();
  if (!code) throw new GivemeInvoiceError("Invoice number is required");
  return callGiveme("query", {
    ...buildAuth(config, now),
    code,
  }, { ...dependencies, config });
}
