export type StorefrontNavItem = {
  label: string;
  href: string;
};

export type StorefrontTheme = {
  accent: string;
  tone: "obsidian" | "stone" | "linen";
  radius: "soft" | "rounded" | "pill";
};

export type StorefrontBrandContent = {
  id: string | null;
  tenantId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  resolvedFromScope: "tenant_default" | "branch_override";
  brandName: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string;
  mobileFeatureImageUrl: string;
  introTitle: string;
  introBody: string;
  servicesSectionTitle: string;
  servicesSectionSubtitle: string;
  bookingNoticeTitle: string;
  bookingNoticeBody: string;
  contactTitle: string;
  contactBody: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  contactLine: string;
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
  aboutSectionEnabled: boolean;
  teamSectionEnabled: boolean;
  portfolioSectionEnabled: boolean;
  contactSectionEnabled: boolean;
  customNavItems: StorefrontNavItem[];
  businessHours: Array<{ label: string; value: string }>;
  theme: StorefrontTheme;
  visualPreferences: Record<string, string | number | boolean | null>;
  updatedAt: string | null;
};

export type StoreBookingSettings = {
  id: string | null;
  tenantId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  resolvedFromScope: "tenant_default" | "branch_override";
  depositsEnabled: boolean;
  packagesEnabled: boolean;
  depositRequiredMode: "optional" | "required";
  depositCalculationType: "fixed" | "percent";
  depositValue: number;
  allowCustomerReschedule: boolean;
  allowCustomerCancel: boolean;
  latestCancelHours: number;
  latestRescheduleHours: number;
  notificationsEnabled: boolean;
  reminderDayBeforeEnabled: boolean;
  reminderHourBeforeEnabled: boolean;
  depositReminderEnabled: boolean;
  crossStoreTherapistEnabled: boolean;
  bookingWindowDays: number;
  minAdvanceMinutes: number;
  slotIntervalMinutes: number;
  timezone: string;
  notes: string;
  updatedAt: string | null;
};

export type StorefrontBranchSummary = {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  address: string | null;
  isActive: boolean;
};

export type StorefrontServiceSummary = {
  id: string;
  code: string;
  name: string;
  description: string;
  durationMinutes: number;
  preBufferMinutes: number;
  postBufferMinutes: number;
  priceAmount: number;
  requiresDeposit: boolean;
  depositCalculationType: "fixed" | "percent";
  depositValue: number;
};

export type StorefrontPayload = {
  branch: StorefrontBranchSummary | null;
  branches: StorefrontBranchSummary[];
  brandContent: StorefrontBrandContent;
  bookingSettings: StoreBookingSettings;
  services: StorefrontServiceSummary[];
};

export type PublicBookingCoach = {
  id: string;
  displayName: string | null;
  branchId: string | null;
  branchIds: string[];
  role: "coach" | "therapist";
};

export type PublicBookingTimeSlot = {
  startsAt: string;
  endsAt: string;
  label: string;
  coachIds: string[];
};

export type PublicBookingPayload = {
  branch: StorefrontBranchSummary | null;
  branches: StorefrontBranchSummary[];
  coaches: PublicBookingCoach[];
  services: StorefrontServiceSummary[];
  bookingSettings: StoreBookingSettings;
  availableDates: string[];
  disabledDates: string[];
  slots: PublicBookingTimeSlot[];
};

export type StorefrontBrandAssetKind = "hero" | "mobile_feature" | "gallery" | "logo" | "other";

export type StorefrontBrandAsset = {
  id: string;
  tenantId: string;
  branchId: string | null;
  kind: StorefrontBrandAssetKind;
  bucketName: string;
  storagePath: string;
  publicUrl: string;
  altText: string;
  contentType: string;
  fileName: string;
  fileSizeBytes: number;
  isActive: boolean;
  isInherited: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ManagerStorefrontPayload = StorefrontPayload & {
  brandAssets: StorefrontBrandAsset[];
};
