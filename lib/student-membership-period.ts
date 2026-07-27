export type MembershipPeriodDraft = {
  startsOn: string;
  expiresOn: string;
};

export type MembershipPeriodStudent = {
  id: string;
  membership_starts_on: string | null;
  membership_expires_on: string | null;
};

export function mergeMembershipPeriodDrafts(
  current: Record<string, MembershipPeriodDraft>,
  students: MembershipPeriodStudent[],
) {
  return Object.fromEntries(
    students.map((student) => {
      const hasSavedPeriod = Boolean(student.membership_starts_on && student.membership_expires_on);
      return [
        student.id,
        hasSavedPeriod
          ? {
              startsOn: student.membership_starts_on || "",
              expiresOn: student.membership_expires_on || "",
            }
          : current[student.id] ?? { startsOn: "", expiresOn: "" },
      ];
    }),
  );
}
