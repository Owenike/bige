import type { StoreBookingSettings, StorefrontBranchSummary, StorefrontServiceSummary } from "./storefront";

export type TherapistBranchLinkSummary = {
  branchId: string;
  branchName: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

export type TherapistSummary = {
  id: string;
  displayName: string | null;
  role: "coach" | "therapist";
  primaryBranchId: string | null;
  primaryBranchName: string | null;
  branchIds: string[];
  branchLinks: TherapistBranchLinkSummary[];
  serviceNames: string[];
  isActive: boolean;
};

export type TherapistRecurringSchedule = {
  id: string;
  coachId: string;
  branchId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  isActive: boolean;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TherapistBlockItem = {
  id: string;
  coachId: string;
  branchId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
  note: string | null;
  status: string;
  blockType: "time_off" | "blocked" | "offsite" | "other";
  createdAt: string | null;
  updatedAt: string | null;
};

export type TherapistManagementPayload = {
  therapists: TherapistSummary[];
  branches: StorefrontBranchSummary[];
  services: StorefrontServiceSummary[];
  schedules: TherapistRecurringSchedule[];
  blocks: TherapistBlockItem[];
};

export type AvailabilityResolutionSummary = {
  branch: StorefrontBranchSummary | null;
  service: StorefrontServiceSummary | null;
  bookingSettings: StoreBookingSettings;
  resolvedCoachId: string | null;
  selectedDate: string | null;
};
