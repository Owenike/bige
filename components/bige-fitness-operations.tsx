"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Dumbbell,
  FileSignature,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  UserRoundCheck,
  X,
} from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BIGE_COURSE_LABELS,
  BIGE_COURSE_TYPES,
  calculateContractTerms,
  calculateMinimumDeposit,
  type BigeCourseType,
} from "../lib/bige-fitness";
import styles from "./bige-fitness-operations.module.css";

type RoleView = "manager" | "frontdesk" | "coach";
type Tab = "schedule" | "contracts" | "plans" | "reminders" | "report";
type DialogName =
  | "schedule"
  | "booking"
  | "contract"
  | "plan"
  | "payment"
  | "extension"
  | null;
type SensitiveCredentials = {
  account: string;
  password: string;
  reason: string;
};

const SENSITIVE_ACTION_LABELS: Record<string, string> = {
  create_plan: "建立課程方案",
  create_contract: "建立正式會員與合約",
  record_payment: "登記合約收款",
  reverse_payment: "退款或作廢付款",
  extend_contract: "辦理合約延期",
  confirm_day: "確認每日報表",
  reopen_day: "重新開啟每日報表",
};

type Coach = { id: string; display_name: string | null };
type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  email_unavailable: boolean;
  birth_date: string | null;
  member_code: string | null;
  is_prospect: boolean;
  attendance_pin_set_at: string | null;
  attendance_pin_reset_required: boolean;
};
type Booking = {
  id: string;
  member_id: string;
  coach_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
  operation_kind: "pt" | "trial";
  course_type: BigeCourseType;
  trial_stage: string | null;
  operation_result: string | null;
  reminder_status: string;
  converted_at: string | null;
};
type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  total_sessions: number;
  price_amount: number;
  course_allocations: Record<BigeCourseType, number>;
  fitness_plan_kind: string;
};
type Contract = {
  id: string;
  contract_number: string;
  status: string;
  payment_status: string;
  signed_on: string;
  ends_at: string;
  total_sessions: number;
  total_amount: number;
  unlocked_sessions: number;
  used_sessions: number;
  remaining_sessions: number;
  course_allocations: Record<BigeCourseType, number>;
  course_used: Record<BigeCourseType, number>;
  extension_limit_days: number;
  extension_used_days: number;
};
export type BoardData = {
  businessDate: string;
  role: string;
  bookings: Booking[];
  notes: Array<{
    id: string;
    coach_id: string;
    starts_at: string;
    ends_at: string;
    content: string;
  }>;
  coaches: Coach[];
  members: Member[];
  plans: Plan[];
  closure: null | {
    id: string;
    status: string;
    revision: number;
    confirmed_at: string | null;
    snapshot: Record<string, number>;
  };
  expiringContracts: Contract[];
};

function apiMessage(payload: any, fallback: string) {
  return payload?.error?.message || payload?.message || payload?.error || fallback;
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(value: string, days: number) {
  const [year, month, date] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function slotKey(value: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function Dialog(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={props.onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{props.title}</h2>
          <button className={styles.iconButton} type="button" onClick={props.onClose} title="關閉">
            <X size={19} />
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}

function PinPad(props: { value: string; onChange: (value: string) => void }) {
  const append = (digit: string) => props.onChange((props.value + digit).slice(0, 6));
  return (
    <>
      <input
        className={`${styles.input} ${styles.pinDisplay}`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoFocus
        aria-label="6 位上課密碼"
        placeholder="••••••"
      />
      <div className={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button className={styles.key} type="button" key={digit} onClick={() => append(digit)}>
            {digit}
          </button>
        ))}
        <button className={styles.key} type="button" onClick={() => props.onChange("")}>
          清除
        </button>
        <button className={styles.key} type="button" onClick={() => append("0")}>
          0
        </button>
        <button className={styles.key} type="button" onClick={() => props.onChange(props.value.slice(0, -1))}>
          刪除
        </button>
      </div>
    </>
  );
}

function SignaturePad(props: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d")!;
    const point = position(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawing.current = true;
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = ref.current!;
    const context = canvas.getContext("2d")!;
    const point = position(event);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.strokeStyle = "#172236";
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const end = () => {
    if (!drawing.current || !ref.current) return;
    drawing.current = false;
    props.onChange(ref.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    props.onChange("");
  };

  return (
    <>
      <canvas
        ref={ref}
        className={styles.signature}
        width={1200}
        height={380}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button className={styles.button} type="button" onClick={clear}>
        清除重簽
      </button>
    </>
  );
}

export default function BigeFitnessOperations({
  view,
  previewData,
}: {
  view: RoleView;
  previewData?: BoardData;
}) {
  const managerView = view === "manager";
  const coachView = view === "coach";
  const viewCopy: Record<RoleView, { title: string; subtitle: string }> = {
    manager: {
      title: "主管營運後台",
      subtitle: "排課、FA 成交、方案、付款解鎖、合約期限與營運報表",
    },
    frontdesk: {
      title: "櫃台營運後台",
      subtitle: "排課、FA 成交、會員合約與明日聯絡工作",
    },
    coach: {
      title: "教練營運後台",
      subtitle: "查看課表、確認到店結果與學員密碼扣堂",
    },
  };
  const [tab, setTab] = useState<Tab>("schedule");
  const [date, setDate] = useState(localDate);
  const [data, setData] = useState<BoardData | null>(previewData || null);
  const [loading, setLoading] = useState(!previewData);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialog, setDialog] = useState<DialogName>(null);
  const [selectedCoach, setSelectedCoach] = useState(
    () => previewData?.coaches[0]?.id || "",
  );
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ members: Member[]; trials: any[] }>({
    members: [],
    trials: [],
  });
  const [memberDetail, setMemberDetail] = useState<{
    member: Member;
    contracts: Contract[];
    paymentSchedule: any[];
    payments: any[];
    extensions: any[];
  } | null>(null);
  const [sensitiveRequest, setSensitiveRequest] = useState<{
    resolve: (credentials: SensitiveCredentials | null) => void;
  } | null>(null);
  const [sensitiveDraft, setSensitiveDraft] = useState<SensitiveCredentials>({
    account: "",
    password: "",
    reason: "",
  });

  const loadBoard = useCallback(async () => {
    if (previewData) {
      setData(previewData);
      setSelectedCoach((current) => current || previewData.coaches[0]?.id || "");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const response = await fetch(`/api/bige-fitness?date=${date}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiMessage(payload, "讀取營運日表失敗"));
      setLoading(false);
      return;
    }
    const next = (payload.data || payload) as BoardData;
    setData(next);
    setSelectedCoach((current) => current || next.coaches[0]?.id || "");
    setLoading(false);
  }, [date, previewData]);

  useEffect(() => {
    if (previewData) return;
    void loadBoard();
  }, [loadBoard, previewData]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults({ members: [], trials: [] });
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/bige-fitness?search=${encodeURIComponent(search.trim())}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) setSearchResults(payload.data || payload);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [previewData, search]);

  const requestSensitiveCredentials = (reason: string) =>
    new Promise<SensitiveCredentials | null>((resolve) => {
      setSensitiveDraft({ account: "", password: "", reason });
      setSensitiveRequest({ resolve });
    });

  const cancelSensitiveRequest = () => {
    sensitiveRequest?.resolve(null);
    setSensitiveRequest(null);
    setSensitiveDraft({ account: "", password: "", reason: "" });
  };

  const confirmSensitiveRequest = (event: FormEvent) => {
    event.preventDefault();
    if (!sensitiveRequest) return;
    sensitiveRequest.resolve(sensitiveDraft);
    setSensitiveRequest(null);
    setSensitiveDraft({ account: "", password: "", reason: "" });
  };

  const post = async (body: Record<string, unknown>) => {
    if (previewData) throw new Error("預覽模式不會寫入資料");
    setError("");
    setSuccess("");
    const action = typeof body.action === "string" ? body.action : "";
    let requestBody = body;
    if (SENSITIVE_ACTION_LABELS[action]) {
      const credentials = await requestSensitiveCredentials(
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : SENSITIVE_ACTION_LABELS[action],
      );
      if (!credentials) throw new Error("已取消敏感操作");
      requestBody = { ...body, reauth: credentials };
    }
    const response = await fetch("/api/bige-fitness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessage(payload, "操作失敗"));
    return payload.data || payload;
  };

  const members = useMemo(
    () => new Map((data?.members || []).map((member) => [member.id, member])),
    [data?.members],
  );

  const loadMember = async (member: Member) => {
    setSelectedMember(member);
    setError("");
    const response = await fetch(`/api/bige-fitness?memberId=${member.id}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiMessage(payload, "讀取合約失敗"));
      return;
    }
    setMemberDetail(payload.data || payload);
    setSearchResults({ members: [], trials: [] });
  };

  const openSlot = (coachId: string, time: string) => {
    if (coachView) return;
    setSelectedCoach(coachId);
    setScheduleDraft((current) => ({ ...current, time }));
    setDialog("schedule");
  };

  const [scheduleDraft, setScheduleDraft] = useState({
    time: "09:00",
    memberId: "",
    trialBookingId: "",
    operationKind: "pt" as "pt" | "trial",
    courseType: "weight_training" as BigeCourseType,
    duration: 60,
    note: "",
  });
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [scheduleResults, setScheduleResults] = useState<{ members: Member[]; trials: any[] }>({
    members: [],
    trials: [],
  });

  useEffect(() => {
    if (previewData) return;
    if (!scheduleSearch.trim()) {
      setScheduleResults({ members: [], trials: [] });
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/bige-fitness?search=${encodeURIComponent(scheduleSearch.trim())}`);
      const payload = await response.json().catch(() => null);
      if (response.ok) setScheduleResults(payload.data || payload);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [previewData, scheduleSearch]);

  const submitSchedule = async (event: FormEvent) => {
    event.preventDefault();
    const startsAt = `${date}T${scheduleDraft.time}:00+08:00`;
    const endsAt = new Date(new Date(startsAt).getTime() + scheduleDraft.duration * 60_000).toISOString();
    try {
      await post({
        action: "create_schedule",
        coachId: selectedCoach,
        memberId: scheduleDraft.operationKind === "pt" ? scheduleDraft.memberId || null : null,
        trialBookingId:
          scheduleDraft.operationKind === "trial" ? scheduleDraft.trialBookingId || null : null,
        operationKind: scheduleDraft.operationKind,
        courseType: scheduleDraft.courseType,
        startsAt,
        endsAt,
        note: scheduleDraft.note || null,
        idempotencyKey: `ui:${crypto.randomUUID()}`,
      });
      setDialog(null);
      setSuccess("排課已建立");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立排課失敗");
    }
  };

  const submitNote = async () => {
    if (!scheduleDraft.note.trim()) {
      setError("請先輸入自由文字內容");
      return;
    }
    const startsAt = `${date}T${scheduleDraft.time}:00+08:00`;
    const endsAt = new Date(new Date(startsAt).getTime() + scheduleDraft.duration * 60_000).toISOString();
    try {
      await post({
        action: "create_note",
        coachId: selectedCoach,
        startsAt,
        endsAt,
        content: scheduleDraft.note,
      });
      setDialog(null);
      setSuccess("教練日表備註已新增");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "備註建立失敗");
    }
  };

  const [pin, setPin] = useState("");
  const completePt = async () => {
    if (!selectedBooking) return;
    try {
      await post({ action: "complete_booking", bookingId: selectedBooking.id, pin });
      setDialog(null);
      setPin("");
      setSuccess("上課已完成並扣除一堂");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "扣堂失敗");
    }
  };

  const updateBooking = async (result: string) => {
    if (!selectedBooking) return;
    try {
      await post({ action: "update_schedule", bookingId: selectedBooking.id, result });
      setDialog(null);
      setSuccess("課程狀態已更新");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失敗");
    }
  };

  const [contractDraft, setContractDraft] = useState({
    fullName: "",
    phone: "",
    birthDate: "",
    email: "",
    emailUnavailable: false,
    planId: "",
    signedOn: localDate(),
    pin: "",
    initialPayment: 0,
    paymentMethod: "cash",
    futureTrialAction: "convert_to_pt",
  });

  const openContract = (booking?: Booking, member?: Member) => {
    const target = member || (booking ? members.get(booking.member_id) : undefined);
    setSelectedBooking(booking || null);
    setSelectedMember(target || null);
    setContractDraft((current) => ({
      ...current,
      fullName: target?.full_name || "",
      phone: target?.phone || "",
      birthDate: target?.birth_date || "",
      email: target?.email || "",
      emailUnavailable: target?.email_unavailable || false,
      planId: data?.plans[0]?.id || "",
      pin: "",
      initialPayment: 0,
    }));
    setDialog("contract");
  };

  const submitContract = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await post({
        action: "create_contract",
        memberId: selectedMember?.id || null,
        sourceBookingId: selectedBooking?.operation_kind === "trial" ? selectedBooking.id : null,
        ...contractDraft,
        initialPayment: Number(contractDraft.initialPayment),
        email: contractDraft.email || null,
        paymentSchedule: [],
      });
      setDialog(null);
      setSuccess("正式會員、合約與堂數已建立");
      await loadBoard();
      if (selectedMember) await loadMember(selectedMember);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成交失敗");
    }
  };

  const [planDraft, setPlanDraft] = useState({
    name: "",
    code: "",
    totalSessions: 36,
    totalAmount: 53568,
    weight_training: 36,
    relaxation: 0,
    reformer_pilates: 0,
    description: "",
  });
  const submitPlan = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await post({
        action: "create_plan",
        name: planDraft.name,
        code: planDraft.code,
        totalSessions: Number(planDraft.totalSessions),
        totalAmount: Number(planDraft.totalAmount),
        allocations: {
          weight_training: Number(planDraft.weight_training),
          relaxation: Number(planDraft.relaxation),
          reformer_pilates: Number(planDraft.reformer_pilates),
        },
        description: planDraft.description || null,
        isCustom: false,
      });
      setDialog(null);
      setSuccess("正式方案已建立");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "方案建立失敗");
    }
  };

  const [paymentDraft, setPaymentDraft] = useState({
    paymentKind: "installment",
    amount: 0,
    method: "cash",
    note: "",
  });
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedContract || !selectedMember) return;
    try {
      await post({
        action: "record_payment",
        contractId: selectedContract.id,
        ...paymentDraft,
        amount: Number(paymentDraft.amount),
        idempotencyKey: `payment:${crypto.randomUUID()}`,
      });
      setDialog(null);
      setSuccess("付款已記錄，可用堂數已依累積付款比例更新");
      await loadMember(selectedMember);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "付款失敗");
    }
  };

  const reversePayment = async (paymentId: string, reversal: "void" | "refund") => {
    if (!selectedMember) return;
    const reason = window.prompt(reversal === "refund" ? "請輸入退款原因" : "請輸入作廢原因");
    if (!reason?.trim()) return;
    try {
      await post({ action: "reverse_payment", paymentId, reversal, reason: reason.trim() });
      setSuccess(reversal === "refund" ? "退款已完成並重新計算可用堂數" : "付款已作廢並重新計算可用堂數");
      await loadMember(selectedMember);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "付款沖銷失敗");
    }
  };

  const [extensionDraft, setExtensionDraft] = useState({
    days: 1,
    reason: "",
    signedName: "",
    signature: "",
  });
  const submitExtension = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedContract || !selectedMember) return;
    try {
      await post({
        action: "extend_contract",
        contractId: selectedContract.id,
        extensionDays: Number(extensionDraft.days),
        reason: extensionDraft.reason,
        signatureDataUrl: extensionDraft.signature,
        signedMemberName: extensionDraft.signedName,
        signedAt: new Date().toISOString(),
      });
      setDialog(null);
      setSuccess("合約延期與學員簽名已保存");
      await loadMember(selectedMember);
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "延期失敗");
    }
  };

  const confirmDay = async () => {
    try {
      await post({ action: "confirm_day", businessDate: date });
      setSuccess("日報已由主管確認");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日報確認失敗");
    }
  };

  const reopenDay = async () => {
    const reason = window.prompt("請輸入重開日報的原因");
    if (!reason?.trim()) return;
    try {
      await post({ action: "reopen_day", businessDate: date, reason: reason.trim() });
      setSuccess("日報已重開並保留原因紀錄");
      await loadBoard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日報重開失敗");
    }
  };

  const hours = useMemo(() => Array.from({ length: 15 }, (_, index) => index + 9), []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E FITNESS OPERATIONS</p>
            <h1 className={styles.title}>{viewCopy[view].title}</h1>
            <p className={styles.subtitle}>{viewCopy[view].subtitle}</p>
          </div>
          <div className={styles.toolbar}>
            <button className={styles.iconButton} onClick={() => setDate(shiftDate(date, -1))} title="前一天">
              <ChevronLeft size={18} />
            </button>
            <input className={styles.input} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button className={styles.iconButton} onClick={() => setDate(shiftDate(date, 1))} title="後一天">
              <ChevronRight size={18} />
            </button>
            <button className={styles.iconButton} onClick={() => void loadBoard()} title="重新整理">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="營運功能">
          <button className={`${styles.tab} ${tab === "schedule" ? styles.activeTab : ""}`} onClick={() => setTab("schedule")}>
            日排課表
          </button>
          {!coachView ? (
            <button className={`${styles.tab} ${tab === "contracts" ? styles.activeTab : ""}`} onClick={() => setTab("contracts")}>
              會員與合約
            </button>
          ) : null}
          {managerView ? (
            <button className={`${styles.tab} ${tab === "plans" ? styles.activeTab : ""}`} onClick={() => setTab("plans")}>
              方案設定
            </button>
          ) : null}
          {!coachView ? (
            <button className={`${styles.tab} ${tab === "reminders" ? styles.activeTab : ""}`} onClick={() => setTab("reminders")}>
              明日 FA 聯絡
            </button>
          ) : null}
          {managerView ? (
            <button className={`${styles.tab} ${tab === "report" ? styles.activeTab : ""}`} onClick={() => setTab("report")}>
              每日報表
            </button>
          ) : null}
          {!coachView ? (
            <a
              className={styles.tab}
              href={managerView ? "/manager/assistance" : "/frontdesk/assistance"}
            >
              行政協助事項
            </a>
          ) : null}
        </nav>

        {error ? <p className={styles.error}>{error}</p> : null}
        {success ? <p className={styles.success}>{success}</p> : null}

        {loading ? <section className={`${styles.glass} ${styles.section}`}>正在讀取營運資料...</section> : null}

        {!loading && data && tab === "schedule" ? (
          data.coaches.length ? (
            <>
              <div className={styles.mobileCoach}>
                <label className={styles.label}>目前教練</label>
                <select className={styles.select} value={selectedCoach} onChange={(event) => setSelectedCoach(event.target.value)}>
                  {data.coaches.map((coach) => (
                    <option value={coach.id} key={coach.id}>
                      {coach.display_name || "未命名教練"}
                    </option>
                  ))}
                </select>
              </div>
              <section className={`${styles.glass} ${styles.boardWrap}`}>
                <div
                  className={styles.board}
                  style={{ "--coach-count": data.coaches.length } as React.CSSProperties}
                >
                  <div className={styles.timeHead}>時間</div>
                  {data.coaches.map((coach) => (
                    <div
                      className={styles.coachHead}
                      data-mobile-active={String(coach.id === selectedCoach)}
                      key={coach.id}
                    >
                      {coach.display_name || "未命名教練"}
                    </div>
                  ))}
                  {hours.map((hour) => (
                    <HourRow
                      key={hour}
                      hour={hour}
                      coaches={data.coaches}
                      selectedCoach={selectedCoach}
                      bookings={data.bookings}
                      notes={data.notes}
                      members={members}
                      onSlot={openSlot}
                      onBooking={(booking) => {
                        setSelectedBooking(booking);
                        setPin("");
                        setDialog("booking");
                      }}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className={`${styles.glass} ${styles.section} ${styles.emptyState}`}>
              <h2 className={styles.sectionTitle}>尚未建立教練帳號</h2>
              <p className={styles.muted}>
                請先由主管建立教練的後台帳號，日排課表才會顯示教練欄位。
              </p>
              {managerView ? (
                <a className={`${styles.button} ${styles.primary}`} href="/manager/staff">
                  前往員工帳號管理
                </a>
              ) : null}
            </section>
          )
        ) : null}

        {!loading && data && tab === "contracts" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>會員與合約</h2>
                <span className={styles.muted}>搜尋既有會員，或直接建立正式會員</span>
              </div>
              <button className={`${styles.button} ${styles.primary}`} onClick={() => openContract()}>
                <Plus size={17} /> 直接建立正式會員
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>姓名、電話或會員編號</label>
              <div className={styles.toolbar}>
                <Search size={18} />
                <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="輸入關鍵字" />
              </div>
            </div>
            {searchResults.members.length ? (
              <div className={styles.list}>
                {searchResults.members.map((member) => (
                  <button className={styles.listItem} key={member.id} onClick={() => void loadMember(member)}>
                    <strong>{member.full_name}</strong> <span className={styles.badge}>{member.member_code || "尚未成交"}</span>
                    <div className={styles.muted}>{member.phone || "無電話"}</div>
                  </button>
                ))}
              </div>
            ) : null}
            {memberDetail ? (
              <div style={{ marginTop: 18 }}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h3 className={styles.sectionTitle}>{memberDetail.member.full_name}</h3>
                    <span className={styles.muted}>
                      {memberDetail.member.member_code || "尚未取得會員編號"} · {memberDetail.member.phone}
                    </span>
                  </div>
                  {!memberDetail.member.member_code ? (
                    <button className={`${styles.button} ${styles.gold}`} onClick={() => openContract(undefined, memberDetail.member)}>
                      建立正式會員
                    </button>
                  ) : null}
                </div>
                <div className={styles.list}>
                  {memberDetail.contracts.map((contract) => (
                    <article className={styles.contract} key={contract.id}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <strong>{contract.contract_number}</strong>{" "}
                          <span className={styles.badge}>{contract.payment_status}</span>
                          <div className={styles.muted}>
                            到期 {formatDateTime(contract.ends_at)} · 已用 {contract.used_sessions} / 已解鎖{" "}
                            {contract.unlocked_sessions} / 總堂數 {contract.total_sessions}
                          </div>
                        </div>
                        <div className={styles.actions}>
                          <button
                            className={styles.button}
                            onClick={() => {
                              setSelectedContract(contract);
                              setPaymentDraft({ paymentKind: "installment", amount: 0, method: "cash", note: "" });
                              setDialog("payment");
                            }}
                          >
                            <CircleDollarSign size={17} /> 登記付款
                          </button>
                          {managerView ? (
                            <button
                              className={styles.button}
                              onClick={() => {
                                setSelectedContract(contract);
                                setExtensionDraft({
                                  days: Math.max(1, contract.extension_limit_days - contract.extension_used_days),
                                  reason: "",
                                  signedName: memberDetail.member.full_name,
                                  signature: "",
                                });
                                setDialog("extension");
                              }}
                            >
                              <FileSignature size={17} /> 延期
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.grid3}>
                        {BIGE_COURSE_TYPES.map((course) => (
                          <div className={styles.summary} key={course}>
                            <span className={styles.label}>{BIGE_COURSE_LABELS[course]}</span>
                            <strong>
                              {contract.course_used?.[course] || 0} / {contract.course_allocations?.[course] || 0}
                            </strong>
                          </div>
                        ))}
                      </div>
                      {memberDetail.payments.some((payment) => payment.contract_id === contract.id) ? (
                        <div className={styles.list} style={{ marginTop: 10 }}>
                          {memberDetail.payments
                            .filter((payment) => payment.contract_id === contract.id)
                            .map((payment) => (
                              <div className={styles.listItem} key={payment.id}>
                                <strong>{formatMoney(payment.amount)}</strong> · {payment.payment_kind} ·{" "}
                                {payment.method} · <span className={styles.badge}>{payment.status}</span>
                                {managerView && payment.status === "recorded" ? (
                                  <div className={styles.actions} style={{ marginTop: 8 }}>
                                    <button className={styles.button} onClick={() => void reversePayment(payment.id, "void")}>
                                      作廢
                                    </button>
                                    <button className={`${styles.button} ${styles.danger}`} onClick={() => void reversePayment(payment.id, "refund")}>
                                      退款
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {!memberDetail.contracts.length ? <p className={styles.muted}>目前沒有正式課程合約。</p> : null}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && data && tab === "plans" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>正式課程方案</h2>
                <span className={styles.muted}>舊方案已從新流程隱藏，現有訂單與 ACPay 不受影響</span>
              </div>
              <button className={`${styles.button} ${styles.primary}`} onClick={() => setDialog("plan")}>
                <Plus size={17} /> 新增方案
              </button>
            </div>
            <div className={styles.grid3}>
              {data.plans.map((plan) => {
                const terms = calculateContractTerms(plan.total_sessions);
                return (
                  <article className={styles.plan} key={plan.id}>
                    <span className={styles.badge}>{plan.code}</span>
                    <h3>{plan.name}</h3>
                    <p className={styles.metric}>{formatMoney(plan.price_amount)}</p>
                    <p className={styles.muted}>
                      {plan.total_sessions} 堂 · 效期 {terms.validityDays} 天 · 最多延期 {terms.extensionLimitDays} 天
                    </p>
                    <p className={styles.muted}>
                      重訓 {plan.course_allocations.weight_training || 0} / 放鬆 {plan.course_allocations.relaxation || 0} / 皮拉提斯{" "}
                      {plan.course_allocations.reformer_pilates || 0}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!loading && data && tab === "reminders" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <h2 className={styles.sectionTitle}>{date} FA 聯絡清單</h2>
            <p className={styles.muted}>切換到明天日期即可於 09:00 查看並更新聯絡結果。</p>
            <div className={styles.list}>
              {data.bookings
                .filter((booking) => booking.operation_kind === "trial")
                .map((booking) => {
                  const member = members.get(booking.member_id);
                  return (
                    <article className={styles.listItem} key={booking.id}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <strong>{member?.full_name || "體驗學員"}</strong> · {slotKey(booking.starts_at)} ·{" "}
                          {booking.trial_stage}
                          <div className={styles.muted}>{member?.phone}</div>
                        </div>
                        <select
                          className={styles.select}
                          value={booking.reminder_status}
                          onChange={async (event) => {
                            try {
                              await post({
                                action: "update_reminder",
                                bookingId: booking.id,
                                status: event.target.value,
                              });
                              await loadBoard();
                            } catch (caught) {
                              setError(caught instanceof Error ? caught.message : "更新失敗");
                            }
                          }}
                        >
                          <option value="pending">待聯絡</option>
                          <option value="reached">已聯絡</option>
                          <option value="no_answer">未接</option>
                          <option value="retry">稍後再聯絡</option>
                        </select>
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ) : null}

        {!loading && data && tab === "report" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>{date} 每日報表</h2>
                <span className={styles.badge}>{data.closure?.status || "尚未產生"}</span>
              </div>
              {data.closure?.status === "confirmed" ? (
                <button className={styles.button} onClick={() => void reopenDay()}>
                  <RotateCcw size={17} /> 輸入原因重開
                </button>
              ) : (
                <button className={`${styles.button} ${styles.primary}`} onClick={() => void confirmDay()}>
                  <ClipboardCheck size={17} /> 主管確認
                </button>
              )}
            </div>
            <div className={styles.grid3}>
              <div className={styles.summary}>
                <span className={styles.label}>全部安排</span>
                <strong className={styles.metric}>{data.bookings.length}</strong>
              </div>
              <div className={styles.summary}>
                <span className={styles.label}>已完成</span>
                <strong className={styles.metric}>{data.bookings.filter((item) => item.status === "completed").length}</strong>
              </div>
              <div className={styles.summary}>
                <span className={styles.label}>待處理</span>
                <strong className={styles.metric}>
                  {data.bookings.filter((item) => ["pending", "confirmed", "booked", "checked_in"].includes(item.status)).length}
                </strong>
              </div>
            </div>
            {data.expiringContracts.length ? (
              <>
                <h3 className={styles.sectionTitle} style={{ marginTop: 22 }}>
                  期限提醒
                </h3>
                <div className={styles.list}>
                  {data.expiringContracts.map((contract) => (
                    <article className={styles.warning} key={contract.id}>
                      {contract.contract_number} · 到期 {formatDateTime(contract.ends_at)} · 可延期餘額{" "}
                      {contract.extension_limit_days - contract.extension_used_days} 天
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      {dialog === "schedule" && data ? (
        <Dialog title="新增排課" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitSchedule}>
            <label className={styles.field}>
              <span className={styles.label}>教練</span>
              <select className={styles.select} value={selectedCoach} onChange={(event) => setSelectedCoach(event.target.value)} required>
                {data.coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coach.display_name || "未命名教練"}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>時間</span>
              <input className={styles.input} value={`${date} ${scheduleDraft.time}`} readOnly />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>類型</span>
              <select
                className={styles.select}
                value={scheduleDraft.operationKind}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, operationKind: event.target.value as "pt" | "trial" })}
              >
                <option value="pt">PT 正式課</option>
                <option value="trial">FA 體驗</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>課別</span>
              <select
                className={styles.select}
                value={scheduleDraft.courseType}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, courseType: event.target.value as BigeCourseType })}
              >
                {BIGE_COURSE_TYPES.map((course) => (
                  <option key={course} value={course}>
                    {BIGE_COURSE_LABELS[course]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>時長</span>
              <select
                className={styles.select}
                value={scheduleDraft.duration}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, duration: Number(event.target.value) })}
              >
                <option value={30}>30 分鐘</option>
                <option value={60}>60 分鐘</option>
                <option value={90}>90 分鐘</option>
                <option value={120}>120 分鐘</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>搜尋學員</span>
              <input className={styles.input} value={scheduleSearch} onChange={(event) => setScheduleSearch(event.target.value)} />
            </label>
            <div className={`${styles.list} ${styles.fieldFull}`}>
              {(scheduleDraft.operationKind === "pt" ? scheduleResults.members : scheduleResults.trials).map((item: any) => (
                <button
                  type="button"
                  className={styles.listItem}
                  key={item.id}
                  onClick={() => {
                    if (scheduleDraft.operationKind === "pt") {
                      setScheduleDraft({ ...scheduleDraft, memberId: item.id });
                    } else {
                      setScheduleDraft({ ...scheduleDraft, trialBookingId: item.id });
                    }
                    setScheduleSearch(item.full_name || item.name);
                    setScheduleResults({ members: [], trials: [] });
                  }}
                >
                  <strong>{item.full_name || item.name}</strong> · {item.phone}
                </button>
              ))}
            </div>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>備註</span>
              <textarea className={styles.textarea} value={scheduleDraft.note} onChange={(event) => setScheduleDraft({ ...scheduleDraft, note: event.target.value })} />
            </label>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                <Check size={17} /> 建立排課
              </button>
              <button className={styles.button} type="button" onClick={() => void submitNote()}>
                只新增自由文字
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "booking" && selectedBooking ? (
        <Dialog title={`${selectedBooking.trial_stage || "PT"} · ${members.get(selectedBooking.member_id)?.full_name || "學員"}`} onClose={() => setDialog(null)}>
          <p className={styles.muted}>
            {formatDateTime(selectedBooking.starts_at)} · {BIGE_COURSE_LABELS[selectedBooking.course_type]} · {selectedBooking.status}
          </p>
          {selectedBooking.operation_kind === "pt" ? (
            <>
              <p className={styles.warning}>請由學員本人使用數字鍵盤輸入 6 位密碼。教練不會看到已設定的密碼。</p>
              <PinPad value={pin} onChange={setPin} />
              <div className={styles.formActions} style={{ marginTop: 14 }}>
                <button className={`${styles.button} ${styles.primary}`} disabled={pin.length !== 6} onClick={() => void completePt()}>
                  <UserRoundCheck size={17} /> 學員確認並完成扣堂
                </button>
                <button className={`${styles.button} ${styles.danger}`} onClick={() => void updateBooking("cancelled")}>
                  取消課程
                </button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.primary}`} onClick={() => void updateBooking("completed")}>
                FA 已完成
              </button>
              <button className={styles.button} onClick={() => void updateBooking("no_show")}>
                未到場
              </button>
              <button className={styles.button} onClick={() => void updateBooking("rescheduled")}>
                改期
              </button>
              <button className={`${styles.button} ${styles.danger}`} onClick={() => void updateBooking("cancelled")}>
                取消
              </button>
              {selectedBooking.status === "completed" && !selectedBooking.converted_at && !coachView ? (
                <button className={`${styles.button} ${styles.gold}`} onClick={() => openContract(selectedBooking)}>
                  <CircleDollarSign size={17} /> FA 成交
                </button>
              ) : null}
            </div>
          )}
        </Dialog>
      ) : null}

      {dialog === "contract" && data ? (
        <Dialog title={selectedBooking ? "FA 成交" : "直接建立正式會員"} onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitContract}>
            <label className={styles.field}>
              <span className={styles.label}>真實姓名</span>
              <input className={styles.input} required value={contractDraft.fullName} onChange={(event) => setContractDraft({ ...contractDraft, fullName: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>手機</span>
              <input className={styles.input} required inputMode="numeric" pattern="09[0-9]{8}" value={contractDraft.phone} onChange={(event) => setContractDraft({ ...contractDraft, phone: event.target.value.replace(/\D/g, "").slice(0, 10) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>生日</span>
              <input className={styles.input} required type="date" value={contractDraft.birthDate} onChange={(event) => setContractDraft({ ...contractDraft, birthDate: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input className={styles.input} type="email" disabled={contractDraft.emailUnavailable} required={!contractDraft.emailUnavailable} value={contractDraft.email} onChange={(event) => setContractDraft({ ...contractDraft, email: event.target.value })} />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <input type="checkbox" checked={contractDraft.emailUnavailable} onChange={(event) => setContractDraft({ ...contractDraft, emailUnavailable: event.target.checked, email: event.target.checked ? "" : contractDraft.email })} /> 學員明確表示沒有 Email
            </label>
            <label className={styles.field}>
              <span className={styles.label}>方案</span>
              <select className={styles.select} required value={contractDraft.planId} onChange={(event) => setContractDraft({ ...contractDraft, planId: event.target.value })}>
                <option value="">請選擇</option>
                {data.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.total_sessions} 堂 · {formatMoney(plan.price_amount)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>簽約日</span>
              <input className={styles.input} required type="date" value={contractDraft.signedOn} onChange={(event) => setContractDraft({ ...contractDraft, signedOn: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>學員上課密碼</span>
              <input className={styles.input} required inputMode="numeric" pattern="[0-9]{6}" value={contractDraft.pin} onChange={(event) => setContractDraft({ ...contractDraft, pin: event.target.value.replace(/\D/g, "").slice(0, 6) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>首次付款</span>
              <input className={styles.input} type="number" min="0" value={contractDraft.initialPayment} onChange={(event) => setContractDraft({ ...contractDraft, initialPayment: Number(event.target.value) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>付款方式</span>
              <select className={styles.select} value={contractDraft.paymentMethod} onChange={(event) => setContractDraft({ ...contractDraft, paymentMethod: event.target.value })}>
                <option value="cash">現金</option>
                <option value="bank_transfer">轉帳</option>
                <option value="card_terminal">刷卡機</option>
                <option value="acpay">ACPay</option>
                <option value="other">其他</option>
              </select>
            </label>
            {selectedBooking ? (
              <label className={styles.field}>
                <span className={styles.label}>未來 FA 預約</span>
                <select className={styles.select} value={contractDraft.futureTrialAction} onChange={(event) => setContractDraft({ ...contractDraft, futureTrialAction: event.target.value })}>
                  <option value="convert_to_pt">全部轉成 PT</option>
                  <option value="cancel">全部取消 FA</option>
                </select>
              </label>
            ) : null}
            {contractDraft.planId ? (
              <p className={`${styles.warning} ${styles.fieldFull}`}>
                最低首次付款：
                {formatMoney(
                  calculateMinimumDeposit(
                    data.plans.find((plan) => plan.id === contractDraft.planId)?.price_amount || 0,
                    data.plans.find((plan) => plan.id === contractDraft.planId)?.total_sessions || 0,
                  ),
                )}
              </p>
            ) : null}
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                <Check size={17} /> 確認建立
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "plan" ? (
        <Dialog title="新增正式課程方案" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitPlan}>
            <label className={styles.field}>
              <span className={styles.label}>方案名稱</span>
              <input className={styles.input} required value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>方案代碼</span>
              <input className={styles.input} required pattern="[A-Za-z0-9_]+" value={planDraft.code} onChange={(event) => setPlanDraft({ ...planDraft, code: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>總堂數</span>
              <input className={styles.input} type="number" min="1" required value={planDraft.totalSessions} onChange={(event) => setPlanDraft({ ...planDraft, totalSessions: Number(event.target.value) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>總價</span>
              <input className={styles.input} type="number" min="1" required value={planDraft.totalAmount} onChange={(event) => setPlanDraft({ ...planDraft, totalAmount: Number(event.target.value) })} />
            </label>
            {BIGE_COURSE_TYPES.map((course) => (
              <label className={styles.field} key={course}>
                <span className={styles.label}>{BIGE_COURSE_LABELS[course]}堂數</span>
                <input className={styles.input} type="number" min="0" required value={planDraft[course]} onChange={(event) => setPlanDraft({ ...planDraft, [course]: Number(event.target.value) })} />
              </label>
            ))}
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              效期 {calculateContractTerms(Number(planDraft.totalSessions)).validityDays} 天，最多延期{" "}
              {calculateContractTerms(Number(planDraft.totalSessions)).extensionLimitDays} 天。
            </p>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                建立方案
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "payment" && selectedContract ? (
        <Dialog title="登記合約付款" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitPayment}>
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              累積付款將依比例無條件捨去計算解鎖堂數。未達下一堂門檻時仍會保留付款紀錄。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>付款類型</span>
              <select className={styles.select} value={paymentDraft.paymentKind} onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentKind: event.target.value })}>
                <option value="deposit">訂金</option>
                <option value="installment">分期</option>
                <option value="balance">尾款</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>金額</span>
              <input className={styles.input} type="number" min="1" required value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: Number(event.target.value) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>方式</span>
              <select className={styles.select} value={paymentDraft.method} onChange={(event) => setPaymentDraft({ ...paymentDraft, method: event.target.value })}>
                <option value="cash">現金</option>
                <option value="bank_transfer">轉帳</option>
                <option value="card_terminal">刷卡機</option>
                <option value="acpay">ACPay</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>備註</span>
              <textarea className={styles.textarea} value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} />
            </label>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                儲存付款
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "extension" && selectedContract ? (
        <Dialog title="合約延期與學員簽名" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitExtension}>
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              累積最多可延期 {selectedContract.extension_limit_days} 天，已使用 {selectedContract.extension_used_days} 天。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>本次延期天數</span>
              <input className={styles.input} type="number" min="1" max={selectedContract.extension_limit_days - selectedContract.extension_used_days} required value={extensionDraft.days} onChange={(event) => setExtensionDraft({ ...extensionDraft, days: Number(event.target.value) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>學員姓名</span>
              <input className={styles.input} required value={extensionDraft.signedName} onChange={(event) => setExtensionDraft({ ...extensionDraft, signedName: event.target.value })} />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>主管原因</span>
              <textarea className={styles.textarea} required value={extensionDraft.reason} onChange={(event) => setExtensionDraft({ ...extensionDraft, reason: event.target.value })} />
            </label>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>學員手寫簽名</span>
              <SignaturePad onChange={(signature) => setExtensionDraft({ ...extensionDraft, signature })} />
            </div>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} disabled={!extensionDraft.signature} type="submit">
                保存簽名並完成延期
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {sensitiveRequest ? (
        <Dialog title="確認本次操作者" onClose={cancelSensitiveRequest}>
          <form className={styles.formGrid} onSubmit={confirmSensitiveRequest}>
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              此操作會留下個人稽核紀錄，請輸入實際操作者的帳號與密碼。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>員工帳號（Email）</span>
              <input
                className={styles.input}
                type="email"
                autoComplete="username"
                required
                value={sensitiveDraft.account}
                onChange={(event) =>
                  setSensitiveDraft({ ...sensitiveDraft, account: event.target.value })
                }
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>密碼</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="current-password"
                required
                value={sensitiveDraft.password}
                onChange={(event) =>
                  setSensitiveDraft({ ...sensitiveDraft, password: event.target.value })
                }
              />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>操作原因</span>
              <textarea
                className={styles.textarea}
                required
                value={sensitiveDraft.reason}
                onChange={(event) =>
                  setSensitiveDraft({ ...sensitiveDraft, reason: event.target.value })
                }
              />
            </label>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={styles.button} type="button" onClick={cancelSensitiveRequest}>
                取消
              </button>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                <Check size={17} /> 驗證並繼續
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </main>
  );
}

function HourRow(props: {
  hour: number;
  coaches: Coach[];
  selectedCoach: string;
  bookings: Booking[];
  notes: BoardData["notes"];
  members: Map<string, Member>;
  onSlot: (coachId: string, time: string) => void;
  onBooking: (booking: Booking) => void;
}) {
  return (
    <>
      <div className={styles.timeCell}>{String(props.hour).padStart(2, "0")}:00</div>
      {props.coaches.map((coach) => (
        <div
          className={styles.slotCell}
          data-mobile-active={String(coach.id === props.selectedCoach)}
          key={`${props.hour}:${coach.id}`}
        >
          {[0, 30].map((minute) => {
            const time = `${String(props.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
            const bookings = props.bookings.filter(
              (booking) => booking.coach_id === coach.id && slotKey(booking.starts_at) === time,
            );
            const notes = props.notes.filter(
              (note) => note.coach_id === coach.id && slotKey(note.starts_at) === time,
            );
            return (
              <div className={styles.halfSlot} key={time}>
                {!bookings.length && !notes.length ? (
                  <button className={styles.slotAdd} onClick={() => props.onSlot(coach.id, time)} title={`新增 ${time} 排課`}>
                    <Plus size={16} /> 新增
                  </button>
                ) : null}
                {bookings.length || notes.length ? (
                  <button className={styles.quickAdd} onClick={() => props.onSlot(coach.id, time)} title={`在 ${time} 加入另一位學員`}>
                    <Plus size={15} />
                  </button>
                ) : null}
                {bookings.map((booking) => (
                  <button
                    className={[
                      styles.booking,
                      booking.operation_kind === "trial" ? styles.bookingTrial : styles.bookingPt,
                      booking.status === "completed" || booking.status === "cancelled" ? styles.bookingDone : "",
                    ].join(" ")}
                    key={booking.id}
                    onClick={() => props.onBooking(booking)}
                  >
                    <span className={styles.bookingName}>
                      {props.members.get(booking.member_id)?.full_name || "學員"}
                    </span>
                    <span className={styles.bookingMeta}>
                      {booking.trial_stage || "PT"} · {BIGE_COURSE_LABELS[booking.course_type]} · {booking.status}
                    </span>
                  </button>
                ))}
                {notes.map((note) => (
                  <div className={styles.note} key={note.id}>
                    {note.content}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
