import type { BookingCapabilityState } from "../lib/platform-booking-capabilities";
import type { StoreBookingSettings } from "./storefront";

export type PlatformOverviewPreset = "today" | "this_week" | "this_month" | "custom";

export type PlatformOverviewRange = {
  preset: PlatformOverviewPreset;
  dateFrom: string;
  dateTo: string;
};

export type PlatformStorefrontSummary = {
  brandName: string | null;
  configured: boolean;
  hasHeroImage: boolean;
  hasMobileImage: boolean;
  activeAssetCount: number;
  updatedAt: string | null;
};

export type PlatformOverviewTenantItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string | null;
  branchCount: number;
  therapistCount: number;
  serviceCount: number;
  bookingTotal: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  completionRate: number;
  depositPendingCount: number;
  packageReservedSessionsCount: number;
  packageConsumedSessionsCount: number;
  notificationQueuedCount: number;
  notificationFailedCount: number;
  recentActivityAt: string | null;
  supportScore: number;
  supportFlags: string[];
  capabilities: BookingCapabilityState[];
  storefront: PlatformStorefrontSummary;
};

export type PlatformOverviewSummary = {
  tenantTotal: number;
  activeTenantCount: number;
  bookingTotal: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  depositPendingCount: number;
  notificationsFailedCount: number;
  packageConsumedSessionsCount: number;
};

export type PlatformOverviewResponse = {
  generatedAt: string;
  range: PlatformOverviewRange;
  filters: {
    statuses: Array<{ value: string; label: string }>;
    presets: Array<{ value: PlatformOverviewPreset; label: string }>;
  };
  summary: PlatformOverviewSummary;
  items: PlatformOverviewTenantItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  warnings: string[];
};

export type PlatformTenantRiskSummary = {
  supportScore: number;
  supportFlags: string[];
  warnings: string[];
};

export type PlatformTenantPaymentSummary = {
  depositPendingCount: number;
  depositPaidTotal: number;
  outstandingTotal: number;
  singleBookingRevenueTotal: number;
  fullyPaidCount: number;
};

export type PlatformTenantPackageSummary = {
  activeEntryPassCount: number;
  activeTemplateCount: number;
  reservedSessionsCount: number;
  consumedSessionsCount: number;
  activePackageBookingCount: number;
};

export type PlatformTenantNotificationSummary = {
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  reminderQueuedCount: number;
  reminderSentCount: number;
  depositPendingQueuedCount: number;
  latestNotificationAt: string | null;
};

export type PlatformTenantBranchItem = {
  branchId: string;
  name: string;
  code: string | null;
  therapistCount: number;
  serviceCount: number;
  bookingCount: number;
  completedCount: number;
  isActive: boolean;
};

export type PlatformTenantTherapistItem = {
  therapistId: string;
  displayName: string;
  branchName: string | null;
  bookingCount: number;
  completedCount: number;
  packageConsumedSessionsCount: number;
};

export type PlatformTenantServiceItem = {
  serviceId: string;
  name: string;
  code: string | null;
  bookingCount: number;
  completedCount: number;
  averagePrice: number;
};

export type PlatformTenantDetailResponse = {
  generatedAt: string;
  range: PlatformOverviewRange;
  tenant: {
    tenantId: string;
    tenantName: string;
    tenantStatus: string | null;
  };
  bookingSummary: Omit<
    PlatformOverviewTenantItem,
    | "tenantId"
    | "tenantName"
    | "tenantStatus"
    | "capabilities"
    | "storefront"
    | "supportScore"
    | "supportFlags"
  >;
  paymentSummary: PlatformTenantPaymentSummary;
  packageSummary: PlatformTenantPackageSummary;
  notificationSummary: PlatformTenantNotificationSummary;
  bookingSettings: StoreBookingSettings;
  capabilities: BookingCapabilityState[];
  storefront: PlatformStorefrontSummary;
  branches: PlatformTenantBranchItem[];
  therapists: PlatformTenantTherapistItem[];
  services: PlatformTenantServiceItem[];
  risk: PlatformTenantRiskSummary;
};
