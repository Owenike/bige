export type BigeMemberSearchRule =
  | {
      mode: "member_number";
      memberCode: string;
    }
  | {
      mode: "legacy_number";
      legacyNumber: string;
    }
  | {
      mode: "phone";
      phoneVariants: string[];
    }
  | {
      mode: "name";
      name: string;
    };

function taiwanPhoneVariants(digits: string) {
  if (/^0\d{9}$/.test(digits)) {
    return [digits, `+886${digits.slice(1)}`, `886${digits.slice(1)}`];
  }
  if (/^886\d{9}$/.test(digits)) {
    return [`+${digits}`, digits, `0${digits.slice(3)}`];
  }
  return [digits];
}

export function resolveBigeMemberSearchRule(value: string): BigeMemberSearchRule {
  const search = value.trim();
  const uppercase = search.toUpperCase();
  if (/^E\d{6}$/.test(uppercase)) {
    return {
      mode: "member_number",
      memberCode: uppercase,
    };
  }

  const phoneLike = search.match(/^\+?(\d+)$/);
  if (phoneLike) {
    const digits = phoneLike[1];
    if (digits.length === 10 || /^886\d{9}$/.test(digits)) {
      return { mode: "phone", phoneVariants: taiwanPhoneVariants(digits) };
    }
    return {
      mode: "legacy_number",
      legacyNumber: digits.replace(/^0+(?=\d)/, ""),
    };
  }

  return { mode: "name", name: search };
}

export function getBigeMemberDisplayNumber(member: {
  member_code?: string | null;
  legacy_numbers?: string[] | null;
}) {
  return (
    member.legacy_numbers?.find((value) => value.trim())?.trim() ||
    member.member_code?.trim() ||
    null
  );
}
