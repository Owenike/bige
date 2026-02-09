export const ENTRY_SCHEMA = {
  membersTable: process.env.ENTRY_MEMBERS_TABLE || "members",
  entitlementsTable: process.env.ENTRY_ENTITLEMENTS_TABLE || "member_entitlements",
  checkinsTable: process.env.ENTRY_CHECKINS_TABLE || "checkins",
  qrTokenUsesTable: process.env.ENTRY_QR_TOKEN_USES_TABLE || "qr_token_uses",
  authUserIdColumn: process.env.ENTRY_AUTH_USER_ID_COLUMN || "auth_user_id",
  memberNameColumn: process.env.ENTRY_MEMBER_NAME_COLUMN || "full_name",
  memberPhotoColumn: process.env.ENTRY_MEMBER_PHOTO_COLUMN || "photo_url",
  memberPhoneColumn: process.env.ENTRY_MEMBER_PHONE_COLUMN || "phone",
  monthlyExpiresAtColumn: process.env.ENTRY_MONTHLY_EXPIRES_AT_COLUMN || "monthly_expires_at",
  remainingSessionsColumn: process.env.ENTRY_REMAINING_SESSIONS_COLUMN || "remaining_sessions",
} as const;
