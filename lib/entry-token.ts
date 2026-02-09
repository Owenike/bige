import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const TOKEN_ISSUER = "bige-entry";
const TOKEN_AUDIENCE = "frontdesk";
export const ENTRY_TOKEN_TTL_SECONDS = 90;
export const ENTRY_TOKEN_REFRESH_SECONDS = 60;

export interface EntryTokenPayload {
  tenantId: string;
  storeId: string;
  memberId: string;
  jti: string;
}

function readEntryTokenSecret(): Uint8Array {
  const secret = process.env.ENTRY_TOKEN_SECRET;
  if (!secret) {
    throw new Error("Missing ENTRY_TOKEN_SECRET");
  }

  return new TextEncoder().encode(secret);
}

export async function issueEntryToken(input: Omit<EntryTokenPayload, "jti">) {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ENTRY_TOKEN_TTL_SECONDS;

  const jwt = await new SignJWT({
    tenant_id: input.tenantId,
    store_id: input.storeId,
    member_id: input.memberId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(readEntryTokenSecret());

  return {
    token: jwt,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    refreshInSeconds: ENTRY_TOKEN_REFRESH_SECONDS,
  };
}

export async function verifyEntryToken(token: string): Promise<EntryTokenPayload> {
  const verified = await jwtVerify(token, readEntryTokenSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });

  const tenantId = String(verified.payload.tenant_id ?? "");
  const storeId = String(verified.payload.store_id ?? "");
  const memberId = String(verified.payload.member_id ?? "");
  const jti = String(verified.payload.jti ?? "");

  if (!tenantId || !storeId || !memberId || !jti) {
    throw new Error("Token payload missing required fields");
  }

  return { tenantId, storeId, memberId, jti };
}
