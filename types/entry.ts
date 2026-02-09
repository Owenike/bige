export type EntryDecision = "allow" | "deny";

export type EntryDenyReason =
  | "token_invalid"
  | "token_expired"
  | "token_used"
  | "rate_limited"
  | "member_not_found"
  | "already_checked_in_recently"
  | "no_valid_pass";

export type MembershipKind = "monthly" | "single" | "punch" | "none";

export interface IssueEntryTokenResponse {
  token: string;
  jti: string;
  expiresAt: string;
  refreshInSeconds: number;
}

export interface VerifyEntryRequest {
  token: string;
}

export interface VerifyEntryResponse {
  decision: EntryDecision;
  reason: EntryDenyReason | null;
  member: {
    id: string;
    name: string;
    photoUrl: string | null;
    phoneLast4: string | null;
  } | null;
  membership: {
    kind: MembershipKind;
    monthlyExpiresAt: string | null;
    remainingSessions: number | null;
  };
  latestCheckinAt: string | null;
  todayCheckinCount: number;
  checkedAt: string;
  gate?: {
    attempted: boolean;
    opened: boolean;
    message: string;
  };
}
