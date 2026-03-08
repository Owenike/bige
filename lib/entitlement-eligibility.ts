import type { SupabaseClient } from "@supabase/supabase-js";
import {
  selectEntitlementCandidate,
  type EntitlementScenario,
  type EntitlementSelectionResult,
} from "./entitlement-selection";

export interface EligibilityCheckInput {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
  branchId?: string | null;
  scenario: EntitlementScenario;
  serviceName?: string | null;
  coachId?: string | null;
  preferredPassId?: string | null;
  preferredContractId?: string | null;
}

export interface EligibilityCheckResult extends EntitlementSelectionResult {
  memberId: string;
  tenantId: string;
}

export async function checkMemberEligibility(input: EligibilityCheckInput): Promise<EligibilityCheckResult> {
  const decision = await selectEntitlementCandidate({
    supabase: input.supabase,
    tenantId: input.tenantId,
    memberId: input.memberId,
    branchId: input.branchId ?? null,
    scenario: input.scenario,
    serviceName: input.serviceName ?? null,
    coachId: input.coachId ?? null,
    preferredPassId: input.preferredPassId ?? null,
    preferredContractId: input.preferredContractId ?? null,
  });
  return {
    ...decision,
    memberId: input.memberId,
    tenantId: input.tenantId,
  };
}
