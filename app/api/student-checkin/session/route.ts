import { NextResponse } from "next/server";
import {
  loadPendingStudentDropInRequest,
  loadStudentDropInEntitlement,
  publicStudentDropInRegistration,
  remainingStudentDropInUses,
  STUDENT_DROP_IN_MAX_USES,
} from "../../../../lib/student-drop-in";
import {
  DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
  studentDropInPlanDetails,
} from "../../../../lib/student-drop-in-plan";
import {
  isCompleteStudentProfile,
  loadPendingCheckinRequest,
  loadStudentProfileById,
  readStudentAuthSession,
  studentMembershipPeriodStatus,
} from "../../../../lib/student-checkin";
import { loadActiveStudentSecuritySetup } from "../../../../lib/student-checkin-security-setup";
import {
  classifyStudentEntryAccess,
  loadStudentEntryAccessSnapshot,
} from "../../../../lib/student-entry-access";

function publicProfile(profile: Awaited<ReturnType<typeof loadStudentProfileById>>) {
  if (!profile) return null;
  return {
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone,
    email: profile.email,
    birthDate: profile.birth_date,
  };
}

export async function GET() {
  const authSession = await readStudentAuthSession();
  if (authSession && ["phone", "passkey"].includes(authSession.authMethod)) {
    const profile = await loadStudentProfileById(authSession.profileId);
    if (isCompleteStudentProfile(profile)) {
      const accessSnapshot = await loadStudentEntryAccessSnapshot(profile.id);
      const autonomousAccessCode = classifyStudentEntryAccess({
        mode: "autonomous",
        ...accessSnapshot,
        autonomousEnabled: profile.autonomous_checkin_enabled,
      });
      const dropInAccessCode = classifyStudentEntryAccess({
        mode: "drop_in",
        ...accessSnapshot,
        autonomousEnabled: profile.autonomous_checkin_enabled,
      });
      if (accessSnapshot.isBlocked) {
        return NextResponse.json({
          ok: true,
          authenticated: true,
          authMethod: authSession.authMethod,
          profile: publicProfile(profile),
          autonomous: {
            eligible: false,
            accessCode: autonomousAccessCode,
            periodStatus: studentMembershipPeriodStatus(profile),
            startsOn: profile.membership_starts_on,
            expiresOn: profile.membership_expires_on,
            request: null,
          },
          dropIn: {
            eligible: false,
            accessCode: dropInAccessCode,
            totalUses: STUDENT_DROP_IN_MAX_USES,
            remainingUses: 0,
            entryPlan: DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
            ...studentDropInPlanDetails(DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN),
            request: null,
            registration: null,
          },
        });
      }
      if (profile.must_complete_security_setup) {
        const securitySetup = await loadActiveStudentSecuritySetup(profile.id);
        return NextResponse.json({
          ok: true,
          authenticated: true,
          authMethod: authSession.authMethod,
          needsSecuritySetup: true,
          profile: publicProfile(profile),
          autonomous: {
            eligible: autonomousAccessCode === "allowed",
            accessCode: autonomousAccessCode,
            periodStatus: studentMembershipPeriodStatus(profile),
            startsOn: profile.membership_starts_on,
            expiresOn: profile.membership_expires_on,
            request: null,
          },
          dropIn: {
            eligible: dropInAccessCode === "allowed",
            accessCode: dropInAccessCode,
            totalUses: STUDENT_DROP_IN_MAX_USES,
            remainingUses: 0,
            entryPlan: DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
            ...studentDropInPlanDetails(DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN),
            request: null,
            registration: null,
          },
          securitySetup: securitySetup
            ? {
                email: securitySetup.pending_email,
                expiresAt: securitySetup.expires_at,
                status: securitySetup.status,
              }
            : null,
        });
      }
      const [request, dropInRequest, dropInEntitlement] = await Promise.all([
        loadPendingCheckinRequest(profile.id),
        loadPendingStudentDropInRequest(profile.id),
        loadStudentDropInEntitlement(profile.id),
      ]);
      const periodStatus = studentMembershipPeriodStatus(profile);
      const entryPlan = dropInEntitlement?.entry_plan ?? DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN;
      return NextResponse.json({
        ok: true,
        authenticated: true,
        authMethod: authSession.authMethod,
        profile: publicProfile(profile),
        request,
        autonomous: {
          eligible: autonomousAccessCode === "allowed",
          accessCode: autonomousAccessCode,
          periodStatus,
          startsOn: profile.membership_starts_on,
          expiresOn: profile.membership_expires_on,
          request,
        },
        dropIn: {
          eligible: dropInAccessCode === "allowed",
          accessCode: dropInAccessCode,
          totalUses: dropInEntitlement?.total_uses ?? STUDENT_DROP_IN_MAX_USES,
          remainingUses: remainingStudentDropInUses(dropInEntitlement),
          entryPlan,
          ...studentDropInPlanDetails(entryPlan),
          request: dropInRequest,
          registration: publicStudentDropInRegistration(dropInEntitlement),
        },
      });
    }
  }
  return NextResponse.json({ ok: true, authenticated: false });
}
