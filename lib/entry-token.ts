import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const TOKEN_ISSUER = "bige-entry";
const TOKEN_AUDIENCE = "frontdesk";
const SHORT_TOKEN_PREFIX = "E1";
const SHORT_TOKEN_SEGMENT_COUNT = 7;
const SHORT_TOKEN_SIG_BYTES = 16;

export const ENTRY_TOKEN_TTL_SECONDS = 90;
export const ENTRY_TOKEN_REFRESH_SECONDS = 60;

export interface EntryTokenPayload {
  tenantId: string;
  storeId: string;
  memberId: string;
  jti: string;
}

export class EntryTokenExpiredError extends Error {
  constructor(message = "Entry token expired") {
    super(message);
    this.name = "EntryTokenExpiredError";
  }
}

export class EntryTokenInvalidError extends Error {
  constructor(message = "Entry token invalid") {
    super(message);
    this.name = "EntryTokenInvalidError";
  }
}

function readEntryTokenSecret(): Uint8Array {
  const secret = process.env.ENTRY_TOKEN_SECRET;
  if (!secret) {
    throw new Error("Missing ENTRY_TOKEN_SECRET");
  }
  return new TextEncoder().encode(secret);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function encodeIdSegment(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new EntryTokenInvalidError("Invalid id in token payload");
  if (isUuid(normalized)) {
    const compactUuid = Buffer.from(normalized.replace(/-/g, ""), "hex").toString("base64url");
    return `u${compactUuid}`;
  }
  return `s${Buffer.from(normalized, "utf8").toString("base64url")}`;
}

function decodeIdSegment(segment: string) {
  const kind = segment.slice(0, 1);
  const body = segment.slice(1);
  if (!kind || !body) throw new EntryTokenInvalidError("Invalid compact id in token payload");

  if (kind === "u") {
    const hex = Buffer.from(body, "base64url").toString("hex");
    if (hex.length !== 32) throw new EntryTokenInvalidError("Invalid compact UUID in token payload");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  if (kind === "s") {
    const value = Buffer.from(body, "base64url").toString("utf8").trim();
    if (!value) throw new EntryTokenInvalidError("Invalid compact string id in token payload");
    return value;
  }

  throw new EntryTokenInvalidError("Unknown compact id kind in token payload");
}

function signShortTokenPayload(payload: string) {
  const fullSig = createHmac("sha256", readEntryTokenSecret()).update(payload).digest();
  return fullSig.subarray(0, SHORT_TOKEN_SIG_BYTES).toString("base64url");
}

function issueShortEntryToken(input: Omit<EntryTokenPayload, "jti"> & { jti: string; exp: number }) {
  const payload = [
    encodeIdSegment(input.tenantId),
    encodeIdSegment(input.storeId),
    encodeIdSegment(input.memberId),
    encodeIdSegment(input.jti),
    input.exp.toString(36),
  ].join(".");
  const sig = signShortTokenPayload(payload);
  return `${SHORT_TOKEN_PREFIX}.${payload}.${sig}`;
}

function verifyShortEntryToken(token: string): EntryTokenPayload {
  const segments = token.split(".");
  if (segments.length !== SHORT_TOKEN_SEGMENT_COUNT || segments[0] !== SHORT_TOKEN_PREFIX) {
    throw new EntryTokenInvalidError();
  }

  const [, tenantSeg, storeSeg, memberSeg, jtiSeg, expSeg, sigSeg] = segments;
  if (!tenantSeg || !storeSeg || !memberSeg || !jtiSeg || !expSeg || !sigSeg) {
    throw new EntryTokenInvalidError();
  }

  const payloadPart = `${tenantSeg}.${storeSeg}.${memberSeg}.${jtiSeg}.${expSeg}`;
  const expectedSig = signShortTokenPayload(payloadPart);
  const actualBuf = Buffer.from(sigSeg, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");

  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new EntryTokenInvalidError();
  }

  const exp = Number.parseInt(expSeg, 36);
  if (!Number.isFinite(exp) || exp <= 0) throw new EntryTokenInvalidError();
  if (Math.floor(Date.now() / 1000) > exp) throw new EntryTokenExpiredError();

  const tenantId = decodeIdSegment(tenantSeg);
  const storeId = decodeIdSegment(storeSeg);
  const memberId = decodeIdSegment(memberSeg);
  const jti = decodeIdSegment(jtiSeg);

  if (!tenantId || !storeId || !memberId || !jti) throw new EntryTokenInvalidError();
  return { tenantId, storeId, memberId, jti };
}

async function issueLegacyJwtToken(input: Omit<EntryTokenPayload, "jti"> & { jti: string; now: number; exp: number }) {
  return new SignJWT({
    tenant_id: input.tenantId,
    store_id: input.storeId,
    member_id: input.memberId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(input.now)
    .setNotBefore(input.now)
    .setExpirationTime(input.exp)
    .setJti(input.jti)
    .sign(readEntryTokenSecret());
}

export async function issueEntryToken(input: Omit<EntryTokenPayload, "jti">) {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ENTRY_TOKEN_TTL_SECONDS;

  // Primary format: compact signed token for better QR scan reliability.
  let token: string;
  try {
    token = issueShortEntryToken({ ...input, jti, exp });
  } catch {
    // Fallback to legacy JWT if compact encoding unexpectedly fails.
    token = await issueLegacyJwtToken({ ...input, jti, now, exp });
  }

  return {
    token,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    refreshInSeconds: ENTRY_TOKEN_REFRESH_SECONDS,
  };
}

async function verifyLegacyJwtToken(token: string): Promise<EntryTokenPayload> {
  const verified = await jwtVerify(token, readEntryTokenSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });

  const tenantId = String(verified.payload.tenant_id ?? "");
  const storeId = String(verified.payload.store_id ?? "");
  const memberId = String(verified.payload.member_id ?? "");
  const jti = String(verified.payload.jti ?? "");

  if (!tenantId || !storeId || !memberId || !jti) {
    throw new EntryTokenInvalidError("Token payload missing required fields");
  }

  return { tenantId, storeId, memberId, jti };
}

export async function verifyEntryToken(token: string): Promise<EntryTokenPayload> {
  const value = token.trim();
  if (!value) throw new EntryTokenInvalidError();

  if (value.startsWith(`${SHORT_TOKEN_PREFIX}.`)) {
    return verifyShortEntryToken(value);
  }

  return verifyLegacyJwtToken(value);
}
