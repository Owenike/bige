"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n-provider";
import { MemberProgressPanel } from "./MemberProgressPanel";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  photo_url?: string | null;
  status?: string | null;
  portal_status?: string | null;
  portal_activated_at?: string | null;
  portal_last_activation_sent_at?: string | null;
  birth_date?: string | null;
  member_code?: string | null;
  custom_fields?: Record<string, string>;
}

interface CustomFieldRow {
  key: string;
  value: string;
}

interface CheckinListItem {
  id: string;
  memberId: string;
  method: string;
  result: string;
  checkedAt: string | null;
}

interface AllMemberEditForm {
  fullName: string;
  phone: string;
  email: string;
  photoUrl: string;
  birthDate: string;
  status: string;
  customRows: CustomFieldRow[];
}

const MEMBER_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function toCustomFields(rows: CustomFieldRow[]) {
  const output: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    output[key] = value;
  }
  return output;
}

function toCustomRows(fields?: Record<string, string>) {
  const entries = Object.entries(fields || {})
    .map(([key, value]) => ({ key, value }))
    .filter((row) => row.key.trim() && row.value.trim());
  return entries.length > 0 ? entries : [{ key: "", value: "" }];
}

function normalizeMemberStatus(input: string | null | undefined) {
  const value = (input || "").trim().toLowerCase();
  if (["active", "expired", "frozen", "suspended", "blacklisted"].includes(value)) return value;
  if (value === "inactive") return "frozen";
  return "active";
}

function buildAllMemberEditForm(member: MemberItem): AllMemberEditForm {
  return {
    fullName: member.full_name || "",
    phone: member.phone || "",
    email: member.email || "",
    photoUrl: member.photo_url || "",
    birthDate: member.birth_date || "",
    status: normalizeMemberStatus(member.status),
    customRows: toCustomRows(member.custom_fields),
  };
}

function cloneAllMemberEditForm(form: AllMemberEditForm): AllMemberEditForm {
  return {
    fullName: form.fullName,
    phone: form.phone,
    email: form.email,
    photoUrl: form.photoUrl,
    birthDate: form.birthDate,
    status: form.status,
    customRows: form.customRows.map((row) => ({ ...row })),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("invalid_file_reader_result"));
      }
    };
    reader.onerror = () => reject(new Error("file_reader_error"));
    reader.readAsDataURL(file);
  });
}

export function FrontdeskMemberSearchView({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [customRows, setCustomRows] = useState<CustomFieldRow[]>([{ key: "", value: "" }]);

  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allMembersOpen, setAllMembersOpen] = useState(false);
  const [allMembersLoading, setAllMembersLoading] = useState(false);
  const [allMembersError, setAllMembersError] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<MemberItem[]>([]);
  const [selectedAllMemberId, setSelectedAllMemberId] = useState<string | null>(null);
  const [allMemberForm, setAllMemberForm] = useState<AllMemberEditForm | null>(null);
  const [allMemberBaseline, setAllMemberBaseline] = useState<AllMemberEditForm | null>(null);
  const [allMemberSaving, setAllMemberSaving] = useState(false);
  const [allMemberMessage, setAllMemberMessage] = useState<string | null>(null);
  const [memberCheckins, setMemberCheckins] = useState<CheckinListItem[]>([]);
  const [memberCheckinsLoading, setMemberCheckinsLoading] = useState(false);
  const [memberCheckinsError, setMemberCheckinsError] = useState<string | null>(null);
  const [activationSendingMemberId, setActivationSendingMemberId] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recentCreatedId, setRecentCreatedId] = useState<string | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] = useState<MemberItem | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const t = useMemo(
    () =>
            zh
        ? {
            badge: "MEMBER DESK",
            title: "會員查詢 / 建檔",
            sub: "快速查詢會員、避免重複建檔，並在櫃檯完成完整會員資料建立。",
            findTitle: "查詢會員",
            findHint: "可用姓名、電話或 Email 完全一致查詢",
            findPlaceholder: "輸入姓名 / 電話 / Email",
            findBtn: "開始查詢",
            findAllBtn: "查看所有會員",
            searching: "查詢中...",
            searchRequireInput: "請先輸入姓名 / 電話 / Email",
            exactNoMatch: "找不到完全一致的會員資料",
            createTitle: "新增會員",
            createName: "姓名",
            createPhone: "電話",
            createEmail: "Email",
            createBirthDate: "生日",
            createBirthDateTag: "生日",
            createGender: "性別",
            emergencyName: "緊急聯絡人",
            emergencyPhone: "緊急聯絡電話",
            leadSource: "載具",
            customTitle: "自訂欄位",
            customKey: "欄位名稱（例：身高）",
            customValue: "欄位內容（例：178）",
            addField: "新增欄位",
            removeField: "刪除",
            createBtn: "建立會員",
            creatingBtn: "建立中...",
            resultTitle: "查詢結果",
            empty: "目前沒有資料",
            searchFail: "查詢失敗",
            createFail: "建立失敗",
            created: "會員建立成功",
            invalidPhone: "電話格式錯誤，請輸入有效電話。",
            duplicateTitle: "偵測到重複會員",
            duplicateDesc: "此電話或 Email 已存在，請選擇下一步操作。",
            useExisting: "使用既有會員",
            editAndRetry: "返回修改後重試",
            usingExisting: "已切換為既有會員",
            continueHint: "可直接用此會員前往收款、預約或入場掃碼。",
            quickActions: "快速下一步",
            goOrder: "新增訂單",
            goBooking: "建立預約",
            goCheckin: "入場掃碼",
            customInfo: "自訂資訊",
            status: "狀態",
            active: "啟用",
            allMembersTitle: "所有會員",
            allMembersSub: "左側按會員編號排序，點選即可查看詳細資料。",
            allMembersLoading: "載入會員中...",
            allMembersEmpty: "目前沒有會員資料",
            memberCode: "會員編號",
            memberId: "會員 ID",
            phoneLabel: "電話",
            emailLabel: "Email",
            photoLabel: "會員照片",
            photoUploadBtn: "上傳照片",
            photoReplaceBtn: "重新上傳",
            photoRemoveBtn: "移除照片",
            photoHint: "建議 JPG / PNG / WEBP，檔案大小 2MB 以內。",
            photoEmpty: "尚未上傳照片",
            photoInvalidType: "請上傳圖片檔（JPG / PNG / WEBP）。",
            photoTooLarge: "照片檔案過大，請上傳 2MB 以內。",
            photoReadFail: "照片讀取失敗，請重試。",
            photoPreviewAlt: "會員照片預覽",
            birthDateLabel: "生日",
            editMemberTitle: "編輯會員資料",
            saveMemberBtn: "儲存修改",
            savingMemberBtn: "儲存中...",
            resetMemberBtn: "還原",
            saveMemberSuccess: "會員資料已更新",
            saveMemberFail: "儲存會員資料失敗",
            nameRequired: "姓名為必填",
            invalidEmail: "Email 格式錯誤",
            invalidBirthDate: "生日格式錯誤",
            statusActive: "啟用",
            statusExpired: "到期",
            statusFrozen: "凍結",
            statusSuspended: "停權",
            statusBlacklisted: "黑名單",
            portalStatus: "會員入口",
            portalPending: "待啟用",
            portalReady: "已啟用",
            portalDisabled: "停用",
            portalActivatedAt: "啟用時間",
            portalLastSentAt: "最近寄送",
            sendActivationEmail: "寄送啟用信",
            sendingActivationEmail: "寄送中...",
            sendActivationEmailDone: "啟用信已寄出",
            sendActivationEmailFail: "寄送啟用信失敗",
            entryRecordTitle: "進場紀錄",
            entryRecordLoading: "載入進場紀錄中...",
            entryRecordEmpty: "目前沒有進場紀錄",
            entryRecordAt: "進場時間",
            entryRecordMethod: "方式",
            entryRecordResult: "結果",
            entryRecordLoadFail: "載入進場紀錄失敗",
            close: "關閉",
          }
        : {
            badge: "MEMBER DESK",
            title: "Member Search / Create",
            sub: "Find members quickly, prevent duplicates, and create complete member profiles at frontdesk.",
            findTitle: "Find Member",
            findHint: "Exact match by name, phone, or email",
            findPlaceholder: "Enter name / phone / email",
            findBtn: "Search",
            findAllBtn: "View All Members",
            searching: "Searching...",
            searchRequireInput: "Enter name / phone / email first",
            exactNoMatch: "No exact member match found",
            createTitle: "Create Member",
            createName: "Full Name",
            createPhone: "Phone",
            createEmail: "Email",
            createBirthDate: "Birth Date",
            createBirthDateTag: "DOB",
            createGender: "Gender",
            emergencyName: "Emergency Contact",
            emergencyPhone: "Emergency Phone",
            leadSource: "Carrier",
            customTitle: "Custom Fields",
            customKey: "Field name (e.g. Height)",
            customValue: "Field value (e.g. 178)",
            addField: "Add Field",
            removeField: "Remove",
            createBtn: "Create Member",
            creatingBtn: "Creating...",
            resultTitle: "Results",
            empty: "No records yet",
            searchFail: "Search failed",
            createFail: "Create failed",
            created: "Member created",
            invalidPhone: "Invalid phone format.",
            duplicateTitle: "Duplicate Member Detected",
            duplicateDesc: "This phone/email already exists. Choose next action.",
            useExisting: "Use Existing Member",
            editAndRetry: "Edit and Retry",
            usingExisting: "Switched to existing member",
            continueHint: "You can continue with this member for payment, booking, or check-in.",
            quickActions: "Quick Actions",
            goOrder: "New Order",
            goBooking: "New Booking",
            goCheckin: "Check-in",
            customInfo: "Custom Info",
            status: "Status",
            active: "Active",
            allMembersTitle: "All Members",
            allMembersSub: "Left list is sorted by member code. Click one member to view details.",
            allMembersLoading: "Loading members...",
            allMembersEmpty: "No members found",
            memberCode: "Member Code",
            memberId: "Member ID",
            phoneLabel: "Phone",
            emailLabel: "Email",
            photoLabel: "Member Photo",
            photoUploadBtn: "Upload Photo",
            photoReplaceBtn: "Replace Photo",
            photoRemoveBtn: "Remove Photo",
            photoHint: "Use JPG / PNG / WEBP, up to 2MB.",
            photoEmpty: "No photo uploaded",
            photoInvalidType: "Please upload an image file (JPG / PNG / WEBP).",
            photoTooLarge: "Image is too large. Please upload a file up to 2MB.",
            photoReadFail: "Failed to read image file. Please try again.",
            photoPreviewAlt: "Member photo preview",
            birthDateLabel: "Birth Date",
            editMemberTitle: "Edit Member",
            saveMemberBtn: "Save",
            savingMemberBtn: "Saving...",
            resetMemberBtn: "Reset",
            saveMemberSuccess: "Member updated",
            saveMemberFail: "Failed to update member",
            nameRequired: "Full name is required",
            invalidEmail: "Invalid email format",
            invalidBirthDate: "Invalid birth date format",
            statusActive: "Active",
            statusExpired: "Expired",
            statusFrozen: "Frozen",
            statusSuspended: "Suspended",
            statusBlacklisted: "Blacklisted",
            portalStatus: "Portal",
            portalPending: "Pending Activation",
            portalReady: "Active",
            portalDisabled: "Disabled",
            portalActivatedAt: "Activated At",
            portalLastSentAt: "Last Activation Email",
            sendActivationEmail: "Send Activation Email",
            sendingActivationEmail: "Sending...",
            sendActivationEmailDone: "Activation email sent",
            sendActivationEmailFail: "Failed to send activation email",
            entryRecordTitle: "Entry Records",
            entryRecordLoading: "Loading entry records...",
            entryRecordEmpty: "No entry records yet",
            entryRecordAt: "Entry Time",
            entryRecordMethod: "Method",
            entryRecordResult: "Result",
            entryRecordLoadFail: "Failed to load entry records",
            close: "Close",
          },
    [zh],
  );

  async function fetchMembers(keyword: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    const trimmed = keyword.trim();
    if (trimmed) params.set("q", trimmed);
    if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
      params.set("limit", String(Math.trunc(options.limit)));
    }
    const endpoint = params.size > 0 ? `/api/members?${params.toString()}` : "/api/members";
    const res = await fetch(endpoint);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || t.searchFail);
    }
    return (payload.items || []) as MemberItem[];
  }

  function memberSortKey(item: MemberItem) {
    const code = typeof item.member_code === "string" ? item.member_code.trim() : "";
    if (!code) return Number.POSITIVE_INFINITY;
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  function sortMembersByCode(list: MemberItem[]) {
    return [...list].sort((a, b) => {
      const aNum = memberSortKey(a);
      const bNum = memberSortKey(b);
      if (aNum !== bNum) return aNum - bNum;
      const aCode = (a.member_code || "").trim();
      const bCode = (b.member_code || "").trim();
      if (aCode !== bCode) return aCode.localeCompare(bCode, "zh-Hant");
      return a.full_name.localeCompare(b.full_name, "zh-Hant");
    });
  }

  function isExactMemberMatch(item: MemberItem, keyword: string) {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) return false;
    const normalizedKeyword = trimmedKeyword.toLowerCase();
    const normalizedPhoneKeyword = normalizePhone(trimmedKeyword);
    const phoneLikeKeyword = /^[\d\s()+-]+$/.test(trimmedKeyword);

    const fullName = (item.full_name || "").trim();
    const emailValue = (item.email || "").trim().toLowerCase();
    const phoneValue = normalizePhone(item.phone || "");

    const matchedName = fullName === trimmedKeyword;
    const matchedEmail = emailValue !== "" && emailValue === normalizedKeyword;
    const matchedPhone = phoneLikeKeyword && normalizedPhoneKeyword.length > 0 && phoneValue === normalizedPhoneKeyword;

    return matchedName || matchedEmail || matchedPhone;
  }

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const keyword = q.trim();
    if (!keyword) {
      setError(t.searchRequireInput);
      setItems([]);
      return;
    }
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const allItems = sortMembersByCode(await fetchMembers("", { limit: 500 }));
      const exactMatches = allItems.filter((item) => isExactMemberMatch(item, keyword));
      setItems(exactMatches);
      if (exactMatches.length === 0) {
        setError(t.exactNoMatch);
        return;
      }
      setAllMembersError(null);
      setAllMembers(allItems);
      setSelectedAllMemberId(exactMatches[0]?.id || null);
      setAllMembersOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.searchFail);
    } finally {
      setLoading(false);
    }
  }

  async function openAllMembersModal() {
    setError(null);
    setMessage(null);
    setAllMembersError(null);
    setAllMembersOpen(true);
    setAllMembersLoading(true);
    try {
      const nextItems = sortMembersByCode(await fetchMembers("", { limit: 500 }));
      setAllMembers(nextItems);
      setSelectedAllMemberId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id || null;
      });
    } catch (err) {
      const nextError = err instanceof Error ? err.message : t.searchFail;
      setAllMembersError(nextError);
      setAllMembers([]);
      setSelectedAllMemberId(null);
    } finally {
      setAllMembersLoading(false);
    }
  }

  const selectedAllMember = useMemo(
    () => allMembers.find((item) => item.id === selectedAllMemberId) || null,
    [allMembers, selectedAllMemberId],
  );
  const selectedAllMemberCode = useMemo(() => {
    if (!selectedAllMember) return "-";
    const directCode = selectedAllMember.member_code?.trim();
    if (directCode) return directCode;
    const index = allMembers.findIndex((item) => item.id === selectedAllMember.id);
    if (index >= 0) return String(index + 1).padStart(4, "0");
    return "-";
  }, [allMembers, selectedAllMember]);
  const allMemberDirty = useMemo(() => {
    if (!allMemberForm || !allMemberBaseline) return false;
    return JSON.stringify(allMemberForm) !== JSON.stringify(allMemberBaseline);
  }, [allMemberBaseline, allMemberForm]);
  const searchKeyword = q.trim();
  const searchDisabled = loading || searchKeyword.length === 0;

  useEffect(() => {
    if (!allMembersOpen || !selectedAllMemberId) return;
    const nodes = document.querySelectorAll<HTMLButtonElement>(".fdAllMembersList [data-member-id]");
    for (const node of Array.from(nodes)) {
      if (node.dataset.memberId === selectedAllMemberId) {
        node.scrollIntoView({ block: "nearest" });
        break;
      }
    }
  }, [allMembersOpen, selectedAllMemberId]);

  useEffect(() => {
    if (!allMembersOpen) return;
    if (!selectedAllMember) {
      setAllMemberForm(null);
      setAllMemberBaseline(null);
      setAllMemberMessage(null);
      return;
    }
    const next = buildAllMemberEditForm(selectedAllMember);
    setAllMemberForm(cloneAllMemberEditForm(next));
    setAllMemberBaseline(cloneAllMemberEditForm(next));
    setAllMemberMessage(null);
    setAllMembersError(null);
  }, [allMembersOpen, selectedAllMember]);

  useEffect(() => {
    if (!allMembersOpen || !selectedAllMember?.id) {
      setMemberCheckins([]);
      setMemberCheckinsError(null);
      setMemberCheckinsLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadMemberCheckins = async () => {
      setMemberCheckinsLoading(true);
      setMemberCheckinsError(null);
      try {
        const res = await fetch(
          `/api/frontdesk/checkins?limit=80&memberId=${encodeURIComponent(selectedAllMember.id)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || t.entryRecordLoadFail);
        if (cancelled) return;
        const rows = ((payload?.items || []) as CheckinListItem[]).filter((item) => item.memberId === selectedAllMember.id);
        setMemberCheckins(rows);
      } catch (err) {
        if (controller.signal.aborted || cancelled) return;
        setMemberCheckins([]);
        setMemberCheckinsError(err instanceof Error ? err.message : t.entryRecordLoadFail);
      } finally {
        if (!cancelled) setMemberCheckinsLoading(false);
      }
    };

    void loadMemberCheckins();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [allMembersOpen, selectedAllMember?.id, t.entryRecordLoadFail]);

  async function saveAllMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedAllMember || !allMemberForm) return;

    const fullName = allMemberForm.fullName.trim();
    const normalizedPhone = normalizePhone(allMemberForm.phone);
    const emailValue = allMemberForm.email.trim().toLowerCase();
    const photoUrlValue = allMemberForm.photoUrl.trim();
    const birthDateValue = allMemberForm.birthDate.trim();
    const statusValue = allMemberForm.status.trim() || "active";

    if (!fullName) {
      setAllMembersError(t.nameRequired);
      setAllMemberMessage(null);
      return;
    }
    if (normalizedPhone && normalizedPhone.length < 8) {
      setAllMembersError(t.invalidPhone);
      setAllMemberMessage(null);
      return;
    }
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setAllMembersError(t.invalidEmail);
      setAllMemberMessage(null);
      return;
    }
    if (birthDateValue && !/^\d{4}-\d{2}-\d{2}$/.test(birthDateValue)) {
      setAllMembersError(t.invalidBirthDate);
      setAllMemberMessage(null);
      return;
    }

    setAllMemberSaving(true);
    setAllMembersError(null);
    setAllMemberMessage(null);
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(selectedAllMember.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone: normalizedPhone || null,
          email: emailValue || null,
          photoUrl: photoUrlValue || null,
          birthDate: birthDateValue || null,
          status: statusValue,
          customFields: toCustomFields(allMemberForm.customRows),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || t.saveMemberFail);
      }
      const nextMember = (payload?.member || null) as MemberItem | null;
      if (!nextMember) throw new Error(t.saveMemberFail);

      setAllMembers((prev) => prev.map((item) => (item.id === nextMember.id ? { ...item, ...nextMember } : item)));
      setItems((prev) => prev.map((item) => (item.id === nextMember.id ? { ...item, ...nextMember } : item)));
      const nextForm = buildAllMemberEditForm(nextMember);
      setAllMemberForm(cloneAllMemberEditForm(nextForm));
      setAllMemberBaseline(cloneAllMemberEditForm(nextForm));
      setAllMemberMessage(t.saveMemberSuccess);
    } catch (err) {
      setAllMembersError(err instanceof Error ? err.message : t.saveMemberFail);
    } finally {
      setAllMemberSaving(false);
    }
  }

  async function onAllMemberPhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAllMembersError(t.photoInvalidType);
      return;
    }
    if (file.size > MEMBER_PHOTO_MAX_BYTES) {
      setAllMembersError(t.photoTooLarge);
      return;
    }
    try {
      const nextPhotoUrl = await fileToDataUrl(file);
      setAllMemberForm((prev) => (prev ? { ...prev, photoUrl: nextPhotoUrl } : prev));
      setAllMembersError(null);
      setAllMemberMessage(null);
    } catch {
      setAllMembersError(t.photoReadFail);
    }
  }

  function fmtDateTime(value: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(locale === "en" ? "en-US" : "zh-TW");
  }

  function portalStatusLabel(value: string | null | undefined) {
    if (value === "active") return t.portalReady;
    if (value === "disabled") return t.portalDisabled;
    return t.portalPending;
  }

  function memberStatusLabel(value: string | null | undefined) {
    const normalized = normalizeMemberStatus(value);
    if (normalized === "active") return t.statusActive;
    if (normalized === "expired") return t.statusExpired;
    if (normalized === "frozen") return t.statusFrozen;
    if (normalized === "suspended") return t.statusSuspended;
    return t.statusBlacklisted;
  }

  async function sendActivationEmailForMember(member: MemberItem) {
    const normalizedPhone = normalizePhone(member.phone || "");
    if (!normalizedPhone) {
      setAllMembersError(t.invalidPhone);
      return;
    }

    setActivationSendingMemberId(member.id);
    setAllMembersError(null);
    setAllMemberMessage(null);
    try {
      const res = await fetch("/api/auth/member-activation/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || t.sendActivationEmailFail);
      }

      const nowIso = new Date().toISOString();
      setAllMembers((prev) =>
        prev.map((item) =>
          item.id === member.id
            ? {
                ...item,
                portal_last_activation_sent_at: nowIso,
              }
            : item,
        ),
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === member.id
            ? {
                ...item,
                portal_last_activation_sent_at: nowIso,
              }
            : item,
        ),
      );
      setMessage(payload?.maskedEmail ? `${t.sendActivationEmailDone}: ${payload.maskedEmail}` : t.sendActivationEmailDone);
      setAllMemberMessage(payload?.maskedEmail ? `${t.sendActivationEmailDone}: ${payload.maskedEmail}` : t.sendActivationEmailDone);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.sendActivationEmailFail;
      setAllMembersError(msg);
      setError(msg);
    } finally {
      setActivationSendingMemberId(null);
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      setError(t.invalidPhone);
      return;
    }

    setError(null);
    setMessage(null);
    setDuplicateCandidate(null);
    setCreating(true);
    try {
      const customFields = toCustomFields(customRows);
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name.trim(),
          phone: normalizedPhone,
          email: email.trim() || null,
          birthDate: birthDate || null,
          gender: gender.trim() || null,
          emergencyName: emergencyName.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          leadSource: leadSource.trim() || null,
          customFields,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (res.status === 409 && payload?.existingMember) {
          setDuplicateCandidate({
            id: String(payload.existingMember.id || ""),
            full_name: String(payload.existingMember.full_name || "-"),
            phone: typeof payload.existingMember.phone === "string" ? payload.existingMember.phone : null,
            email: typeof payload.existingMember.email === "string" ? payload.existingMember.email : null,
            custom_fields:
              payload.existingMember.custom_fields && typeof payload.existingMember.custom_fields === "object"
                ? payload.existingMember.custom_fields
                : {},
          });
          return;
        }
        setError(payload?.error || t.createFail);
        return;
      }
      const createdId = String(payload?.member?.id || "");
      setName("");
      setPhone("");
      setEmail("");
      setBirthDate("");
      setGender("");
      setEmergencyName("");
      setEmergencyPhone("");
      setLeadSource("");
      setCustomRows([{ key: "", value: "" }]);
      setRecentCreatedId(createdId || null);
      setQ(payload?.member?.phone || "");
      setMessage(`${t.created}: ${createdId}`);
      await search();
    } finally {
      setCreating(false);
    }
  }

  const quickActionsContent = recentCreatedId ? (
    <div className="fdGlassSubPanel fdMemberQuickActions" style={{ padding: 14, marginBottom: embedded ? 0 : 12 }}>
      <h2 className="sectionTitle" style={{ marginBottom: 8 }}>{t.quickActions}</h2>
      <div className="actions" style={{ marginTop: 0 }}>
        <a className="fdPillBtn fdPillBtnPrimary" href={`/frontdesk/orders/new?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goOrder}</a>
        <a className="fdPillBtn" href={`/frontdesk/bookings?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goBooking}</a>
        <a className="fdPillBtn" href="/frontdesk/checkin">{t.goCheckin}</a>
      </div>
    </div>
  ) : null;

  const resultContent = (
    <section style={{ marginTop: embedded ? 12 : 14 }}>
      <h2 className="sectionTitle">{t.resultTitle}</h2>
      <div
        className={`fdActionGrid ${embedded ? "fdMemberInlineResultGrid" : ""}`}
        style={{ gridTemplateColumns: embedded ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))" }}
      >
        {items.length === 0 ? (
          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
            <div className="kvValue">{t.empty}</div>
          </div>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="fdGlassSubPanel fdActionCard"
              style={{
                padding: 14,
                borderColor: item.id === recentCreatedId ? "rgba(116,182,241,.9)" : undefined,
                boxShadow: item.id === recentCreatedId ? "0 0 0 2px rgba(159,212,255,.45)" : undefined,
              }}
            >
              <h3 className="fdActionTitle" style={{ fontSize: 20 }}>{item.full_name}</h3>
              <p className="fdGlassText" style={{ marginTop: 6 }}>{item.phone || "-"}</p>
              <p className="fdGlassText" style={{ marginTop: 4 }}>{item.email || "-"}</p>
              <p className="fdGlassText" style={{ marginTop: 4 }}>
                {t.status}: {memberStatusLabel(item.status)}
              </p>
              <p className="fdGlassText" style={{ marginTop: 4 }}>
                {t.portalStatus}: {portalStatusLabel(item.portal_status)}
              </p>
              <p className="fdGlassText" style={{ marginTop: 4 }}>
                {t.portalActivatedAt}: {fmtDateTime(item.portal_activated_at || null)}
              </p>
              <p className="fdGlassText" style={{ marginTop: 4 }}>
                {t.portalLastSentAt}: {fmtDateTime(item.portal_last_activation_sent_at || null)}
              </p>
              <div className="actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="fdPillBtn"
                  disabled={activationSendingMemberId === item.id}
                  onClick={() => void sendActivationEmailForMember(item)}
                >
                  {activationSendingMemberId === item.id ? t.sendingActivationEmail : t.sendActivationEmail}
                </button>
              </div>
              {item.custom_fields && Object.keys(item.custom_fields).length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <p className="fdGlassText" style={{ marginTop: 0, fontSize: 12 }}>{t.customInfo}</p>
                  <div className="actions" style={{ marginTop: 6 }}>
                    {Object.entries(item.custom_fields).map(([key, value]) => (
                      <span key={`${item.id}-${key}`} className="fdChip">{key}: {value}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );

  return (
    <main className={embedded ? "fdEmbedScene" : "fdGlassScene"} style={embedded ? { width: "100%", margin: 0, padding: 0 } : undefined}>
      <section
        className={embedded ? "fdEmbedBackdrop" : "fdGlassBackdrop"}
        style={embedded ? { minHeight: "auto", height: "auto", padding: 12 } : undefined}
      >
        {!embedded ? (
          <section className="hero" style={{ paddingTop: 0 }}>
            <div className="fdGlassPanel">
              <div className="fdEyebrow">{t.badge}</div>
              <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>{t.title}</h1>
              <p className="fdGlassText">{t.sub}</p>
            </div>
          </section>
        ) : (
          <div className="fdGlassSubPanel" style={{ padding: 12, marginBottom: 12 }}>
            <h2 className="sectionTitle" style={{ marginBottom: 2 }}>{t.title}</h2>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.sub}</p>
          </div>
        )}

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        {duplicateCandidate ? (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", display: "grid", placeItems: "center", zIndex: 80, padding: 16 }}
            onClick={() => setDuplicateCandidate(null)}
          >
            <div
              className="fdGlassSubPanel"
              style={{ width: "min(560px, 100%)", padding: 16, borderColor: "rgba(190,24,93,.45)" }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h2 className="sectionTitle">{t.duplicateTitle}</h2>
              <p className="fdGlassText" style={{ marginTop: 4 }}>{t.duplicateDesc}</p>
              <p className="fdGlassText" style={{ marginTop: 6 }}>
                {duplicateCandidate.full_name} | {duplicateCandidate.phone || "-"} | {duplicateCandidate.email || "-"}
              </p>
              <div className="actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnPrimary"
                  onClick={async () => {
                    setDuplicateCandidate(null);
                    setRecentCreatedId(duplicateCandidate.id);
                    setMessage(`${t.usingExisting}: ${duplicateCandidate.id}`);
                    setQ(duplicateCandidate.phone || duplicateCandidate.full_name);
                    await search();
                  }}
                >
                  {t.useExisting}
                </button>
                <button type="button" className="fdPillBtn" onClick={() => setDuplicateCandidate(null)}>
                  {t.editAndRetry}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section
          className={`fdTwoCol ${embedded ? "fdMemberModalCols" : ""}`}
          style={embedded ? undefined : { gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}
        >
          <div className="fdGlassSubPanel fdMemberFindPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.findTitle}</h2>
            <p className="fdGlassText" style={{ marginTop: 6 }}>{t.findHint}</p>
            <form onSubmit={search} className="field">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.findPlaceholder} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={searchDisabled}>
                {loading ? t.searching : t.findBtn}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void openAllMembersModal()} disabled={allMembersLoading}>
                {allMembersLoading ? t.allMembersLoading : t.findAllBtn}
              </button>
            </form>
            {embedded ? resultContent : null}
          </div>

          <div className="fdGlassSubPanel fdMemberCreatePanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.createTitle}</h2>
            <form onSubmit={createMember} className="field">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.createName} className="input" required />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.createPhone} className="input" required />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.createEmail} className="input" />
              <div className="fdBirthDateField">
                <input
                  id="fd-member-birth-date"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="input"
                  aria-label={t.createBirthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  style={{ paddingRight: 116 }}
                />
                <span className="kvLabel fdBirthDateTag">
                  {t.createBirthDateTag}
                </span>
              </div>
              <input value={gender} onChange={(e) => setGender(e.target.value)} placeholder={t.createGender} className="input" />
              <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder={t.emergencyName} className="input" />
              <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder={t.emergencyPhone} className="input" />
              <input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder={t.leadSource} className="input" />

              <label className="fdGlassText" style={{ marginTop: 0 }}>{t.customTitle}</label>
              {customRows.map((row, idx) => (
                <div key={`${idx}-${row.key}`} className="fdMemberCustomRow">
                  <input
                    value={row.key}
                    onChange={(e) => setCustomRows((prev) => prev.map((it, i) => (i === idx ? { ...it, key: e.target.value } : it)))}
                    placeholder={t.customKey}
                    className="input"
                  />
                  <input
                    value={row.value}
                    onChange={(e) => setCustomRows((prev) => prev.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it)))}
                    placeholder={t.customValue}
                    className="input"
                  />
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => setCustomRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))}
                  >
                    {t.removeField}
                  </button>
                </div>
              ))}
              <button type="button" className="fdPillBtn" onClick={() => setCustomRows((prev) => [...prev, { key: "", value: "" }])}>
                {t.addField}
              </button>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={creating}>
                {creating ? t.creatingBtn : t.createBtn}
              </button>
            </form>
            <p className="fdGlassText" style={{ marginTop: 10, fontSize: 12 }}>{t.continueHint}</p>
            {embedded ? quickActionsContent : null}
          </div>
        </section>

        {!embedded ? quickActionsContent : null}
        {!embedded ? resultContent : null}

        {allMembersOpen && portalReady ? createPortal(
          <div className="fdModalBackdrop fdNestedMemberBackdrop" onClick={() => setAllMembersOpen(false)} role="presentation">
            <div
              className="fdModal fdModalLight fdModalHandover fdAllMembersModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t.allMembersTitle}
            >
              <div className="fdModalHead">
                <h2 className="sectionTitle" style={{ margin: 0 }}>{t.allMembersTitle}</h2>
                <button type="button" className="fdModalIconBtn" aria-label={t.close} onClick={() => setAllMembersOpen(false)}>
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="fdAllMembersBody">
                <p className="sub fdAllMembersSub">{t.allMembersSub}</p>
                {allMembersError ? <div className="error">{allMembersError}</div> : null}

                <div className="fdAllMembersGrid">
                  <aside className="fdAllMembersList">
                    {allMembersLoading ? (
                      <p className="sub">{t.allMembersLoading}</p>
                    ) : allMembers.length === 0 ? (
                      <p className="sub">{t.allMembersEmpty}</p>
                    ) : (
                      allMembers.map((item, idx) => {
                        const selected = item.id === selectedAllMemberId;
                        const memberCode = item.member_code?.trim() || String(idx + 1).padStart(4, "0");
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedAllMemberId(item.id)}
                            className={`fdAllMemberItem ${selected ? "fdAllMemberItemActive" : ""}`}
                            data-member-id={item.id}
                          >
                            <div className="kvLabel">#{memberCode}</div>
                            <div className="kvValue" style={{ marginTop: 4 }}>{item.full_name}</div>
                            <div className="sub" style={{ marginTop: 4 }}>{item.phone || "-"}</div>
                          </button>
                        );
                      })
                    )}
                  </aside>

                  <section className="fdAllMembersDetail">
                    {selectedAllMember && allMemberForm ? (
                      <form onSubmit={saveAllMember} className="field" style={{ gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <h3 className="sectionTitle" style={{ marginTop: 0, marginBottom: 0 }}>{t.editMemberTitle}</h3>
                          <div className="actions" style={{ marginTop: 0 }}>
                            <button
                              type="button"
                              className="fdPillBtn"
                              onClick={() => {
                                if (!allMemberBaseline) return;
                                setAllMemberForm(cloneAllMemberEditForm(allMemberBaseline));
                                setAllMemberMessage(null);
                                setAllMembersError(null);
                              }}
                              disabled={allMemberSaving || !allMemberDirty}
                            >
                              {t.resetMemberBtn}
                            </button>
                            <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={allMemberSaving || !allMemberDirty}>
                              {allMemberSaving ? t.savingMemberBtn : t.saveMemberBtn}
                            </button>
                          </div>
                        </div>

                        {allMemberMessage ? <p className="sub" style={{ marginTop: 0, color: "var(--brand)" }}>{allMemberMessage}</p> : null}

                        <div className="fdMemberEditTopLayout" style={{ marginTop: 2 }}>
                          <div className="fdGlassSubPanel fdMemberPhotoPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)" }}>
                            <div className="kvLabel">{t.photoLabel}</div>
                            <div className="fdMemberPhotoPreview">
                              {allMemberForm.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={allMemberForm.photoUrl} alt={t.photoPreviewAlt} className="fdMemberPhotoImg" />
                              ) : (
                                <span className="sub">{t.photoEmpty}</span>
                              )}
                            </div>
                            <p className="sub fdMemberPhotoHint">{t.photoHint}</p>
                            <div className="actions fdMemberPhotoActions" style={{ marginTop: 8 }}>
                              <label className="fdPillBtn fdPillBtnPrimary fdMemberPhotoUploadBtn">
                                {allMemberForm.photoUrl ? t.photoReplaceBtn : t.photoUploadBtn}
                                <input type="file" accept="image/*" onChange={onAllMemberPhotoSelected} disabled={allMemberSaving} />
                              </label>
                              <button
                                type="button"
                                className="fdPillBtn"
                                disabled={allMemberSaving || !allMemberForm.photoUrl}
                                onClick={() => {
                                  setAllMemberForm((prev) => (prev ? { ...prev, photoUrl: "" } : prev));
                                  setAllMembersError(null);
                                  setAllMemberMessage(null);
                                }}
                              >
                                {t.photoRemoveBtn}
                              </button>
                            </div>
                          </div>

                          <div className="fdTwoCol fdMemberProfileGrid" style={{ gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                            <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)" }}>
                              <div className="kvLabel">{t.memberCode}</div>
                              <div className="kvValue">#{selectedAllMemberCode}</div>
                            </div>
                            <label className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)", display: "grid", gap: 6 }}>
                              <span className="kvLabel">{t.createName}</span>
                              <input
                                className="input"
                                value={allMemberForm.fullName}
                                onChange={(event) => setAllMemberForm((prev) => (prev ? { ...prev, fullName: event.target.value } : prev))}
                                disabled={allMemberSaving}
                                required
                              />
                            </label>
                            <label className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)", display: "grid", gap: 6 }}>
                              <span className="kvLabel">{t.phoneLabel}</span>
                              <input
                                className="input"
                                value={allMemberForm.phone}
                                onChange={(event) => setAllMemberForm((prev) => (prev ? { ...prev, phone: event.target.value } : prev))}
                                disabled={allMemberSaving}
                                placeholder={t.createPhone}
                              />
                            </label>
                            <label className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)", display: "grid", gap: 6 }}>
                              <span className="kvLabel">{t.emailLabel}</span>
                              <input
                                className="input"
                                value={allMemberForm.email}
                                onChange={(event) => setAllMemberForm((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                                disabled={allMemberSaving}
                                placeholder={t.createEmail}
                              />
                            </label>
                            <label className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)", display: "grid", gap: 6 }}>
                              <span className="kvLabel">{t.birthDateLabel}</span>
                              <input
                                className="input"
                                type="date"
                                value={allMemberForm.birthDate}
                                onChange={(event) => setAllMemberForm((prev) => (prev ? { ...prev, birthDate: event.target.value } : prev))}
                                disabled={allMemberSaving}
                              />
                            </label>
                            <label className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)", display: "grid", gap: 6 }}>
                              <span className="kvLabel">{t.status}</span>
                              <select
                                className="input"
                                value={allMemberForm.status}
                                onChange={(event) => setAllMemberForm((prev) => (prev ? { ...prev, status: event.target.value } : prev))}
                                disabled={allMemberSaving}
                              >
                                <option value="active">{t.statusActive}</option>
                                <option value="expired">{t.statusExpired}</option>
                                <option value="frozen">{t.statusFrozen}</option>
                                <option value="suspended">{t.statusSuspended}</option>
                                <option value="blacklisted">{t.statusBlacklisted}</option>
                              </select>
                            </label>
                            <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.96)" }}>
                              <div className="kvLabel">{t.portalStatus}</div>
                              <div className="sub" style={{ marginTop: 6 }}>{portalStatusLabel(selectedAllMember.portal_status)}</div>
                              <div className="sub" style={{ marginTop: 6 }}>
                                {t.portalActivatedAt}: {fmtDateTime(selectedAllMember.portal_activated_at || null)}
                              </div>
                              <div className="sub" style={{ marginTop: 6 }}>
                                {t.portalLastSentAt}: {fmtDateTime(selectedAllMember.portal_last_activation_sent_at || null)}
                              </div>
                              <div className="actions" style={{ marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="fdPillBtn"
                                  disabled={activationSendingMemberId === selectedAllMember.id}
                                  onClick={() => void sendActivationEmailForMember(selectedAllMember)}
                                >
                                  {activationSendingMemberId === selectedAllMember.id ? t.sendingActivationEmail : t.sendActivationEmail}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="fdGlassSubPanel" style={{ marginTop: 6, padding: 10, background: "rgba(255,255,255,.96)" }}>
                          <div className="kvLabel">{t.customInfo}</div>
                          <div className="field" style={{ marginTop: 8 }}>
                            {allMemberForm.customRows.map((row, idx) => (
                              <div key={`${idx}-${row.key}`} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto" }}>
                                <input
                                  className="input"
                                  value={row.key}
                                  placeholder={t.customKey}
                                  disabled={allMemberSaving}
                                  onChange={(event) =>
                                    setAllMemberForm((prev) => {
                                      if (!prev) return prev;
                                      return {
                                        ...prev,
                                        customRows: prev.customRows.map((item, rowIndex) =>
                                          rowIndex === idx ? { ...item, key: event.target.value } : item,
                                        ),
                                      };
                                    })
                                  }
                                />
                                <input
                                  className="input"
                                  value={row.value}
                                  placeholder={t.customValue}
                                  disabled={allMemberSaving}
                                  onChange={(event) =>
                                    setAllMemberForm((prev) => {
                                      if (!prev) return prev;
                                      return {
                                        ...prev,
                                        customRows: prev.customRows.map((item, rowIndex) =>
                                          rowIndex === idx ? { ...item, value: event.target.value } : item,
                                        ),
                                      };
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="fdPillBtn"
                                  disabled={allMemberSaving}
                                  onClick={() =>
                                    setAllMemberForm((prev) => {
                                      if (!prev) return prev;
                                      if (prev.customRows.length <= 1) return prev;
                                      return {
                                        ...prev,
                                        customRows: prev.customRows.filter((_, rowIndex) => rowIndex !== idx),
                                      };
                                    })
                                  }
                                >
                                  {t.removeField}
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="fdPillBtn"
                              disabled={allMemberSaving}
                              onClick={() =>
                                setAllMemberForm((prev) => {
                                  if (!prev) return prev;
                                  return { ...prev, customRows: [...prev.customRows, { key: "", value: "" }] };
                                })
                              }
                            >
                              {t.addField}
                            </button>
                          </div>
                        </div>

                        <div className="fdGlassSubPanel" style={{ marginTop: 6, padding: 10, background: "rgba(255,255,255,.96)" }}>
                          <div className="kvLabel">{t.entryRecordTitle}</div>
                          {memberCheckinsLoading ? (
                            <p className="sub" style={{ marginTop: 8 }}>{t.entryRecordLoading}</p>
                          ) : memberCheckinsError ? (
                            <p className="sub" style={{ marginTop: 8, color: "#c2410c" }}>{memberCheckinsError}</p>
                          ) : memberCheckins.length === 0 ? (
                            <p className="sub" style={{ marginTop: 8 }}>{t.entryRecordEmpty}</p>
                          ) : (
                            <div className="fdListStack" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                              {memberCheckins.map((item) => (
                                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                                  <p className="sub" style={{ marginTop: 0 }}>
                                    {t.entryRecordAt}: {fmtDateTime(item.checkedAt)}
                                  </p>
                                  <p className="sub" style={{ marginTop: 4 }}>
                                    {t.entryRecordMethod}: {item.method || "-"} | {t.entryRecordResult}: {item.result || "-"}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <MemberProgressPanel
                          memberId={selectedAllMember.id}
                          memberName={selectedAllMember.full_name || ""}
                        />
                      </form>
                    ) : (
                      <p className="sub">{t.allMembersEmpty}</p>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        ) : null}
      </section>
    </main>
  );
}
