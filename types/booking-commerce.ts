export type BookingPaymentMode = "single" | "package";
export type BookingCommercialPaymentStatus =
  | "unpaid"
  | "deposit_pending"
  | "deposit_paid"
  | "fully_paid"
  | "refunded"
  | "partially_refunded";

export type MemberPackageOption = {
  entryPassId: string;
  contractId: string | null;
  planCatalogId: string | null;
  branchId: string | null;
  packageName: string;
  packageCode: string | null;
  planType: string | null;
  remainingSessions: number;
  reservedSessions: number;
  availableSessions: number;
  totalSessions: number | null;
  expiresAt: string | null;
  status: string;
  serviceScope: string[];
};

export type BookingCommercialSnapshot = {
  paymentMode: BookingPaymentMode;
  paymentStatus: BookingCommercialPaymentStatus;
  finalAmount: number;
  outstandingAmount: number;
  depositRequiredAmount: number;
  depositPaidAmount: number;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentUpdatedAt: string | null;
  entryPassId: string | null;
  contractId: string | null;
  packageSessionsReserved: number;
  packageSessionsConsumed: number;
  packageName: string | null;
};

export type BookingPackageLogItem = {
  id: string;
  action: "reserve" | "consume" | "release" | "adjust";
  sessionsDelta: number;
  reason: string | null;
  note: string | null;
  packageName: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type ManagerPackageTemplateItem = {
  id: string;
  tenantId: string;
  branchId: string | null;
  code: string;
  name: string;
  description: string | null;
  planType: "entry_pass" | "coach_pack";
  fulfillmentKind: "entry_pass";
  totalSessions: number;
  validDays: number | null;
  priceAmount: number;
  serviceScope: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ManagerMemberPackageItem = {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  branchId: string | null;
  branchName: string | null;
  packageName: string;
  packageCode: string | null;
  remainingSessions: number;
  reservedSessions: number;
  totalSessions: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  status: string;
};

export type ManagerPackagesResponse = {
  templates: ManagerPackageTemplateItem[];
  memberPackages: ManagerMemberPackageItem[];
};
