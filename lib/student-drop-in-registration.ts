export const STUDENT_DROP_IN_TERMS_VERSION = "2026-08-11";

export const STUDENT_DROP_IN_GENDERS = ["male", "female"] as const;
export type StudentDropInGender = (typeof STUDENT_DROP_IN_GENDERS)[number];

export const STUDENT_DROP_IN_ACTIVITY_INTERESTS = ["weight_training", "reformer_pilates"] as const;
export type StudentDropInActivityInterest = (typeof STUDENT_DROP_IN_ACTIVITY_INTERESTS)[number];

export type StudentDropInRegistrationRecord = {
  invoice_carrier: string | null;
  gender: StudentDropInGender | null;
  activity_interest: StudentDropInActivityInterest | null;
  discovery_source: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  registration_correction_required: boolean;
  correction_requested_at: string | null;
};

export function hasCurrentStudentDropInTermsAcceptance(
  record: Pick<StudentDropInRegistrationRecord, "terms_version" | "terms_accepted_at"> | null | undefined,
) {
  return Boolean(
    record?.terms_version === STUDENT_DROP_IN_TERMS_VERSION &&
      record.terms_accepted_at,
  );
}

export function isStudentDropInRegistrationComplete(
  record: StudentDropInRegistrationRecord | null | undefined,
) {
  return Boolean(
    record?.invoice_carrier?.trim() &&
      record.gender &&
      record.activity_interest &&
      record.discovery_source?.trim() &&
      hasCurrentStudentDropInTermsAcceptance(record) &&
      !record.registration_correction_required,
  );
}

export function studentDropInGenderLabel(value: StudentDropInGender | null | undefined) {
  if (value === "male") return "男";
  if (value === "female") return "女";
  return "-";
}

export function studentDropInActivityInterestLabel(
  value: StudentDropInActivityInterest | null | undefined,
) {
  if (value === "weight_training") return "重量訓練課程（增肌減脂、提高代謝🔥）";
  if (value === "reformer_pilates") return "器械皮拉提斯課（加強核心、美化線條😍）";
  return "-";
}

export const STUDENT_DROP_IN_TERMS_INTRO =
  "謝謝您參加巨挺健身開幕活動。為了完成登記與後續服務，我們請您閱讀並同意以下條款：";

export const STUDENT_DROP_IN_TERMS_SECTIONS = [
  {
    title: "第一條：基本立約聲明",
    paragraphs: [
      "本條款係為巨挺健身（以下簡稱「本公司」）與填寫者（以下簡稱「會員」或「您」）之間所訂定合約條款，雙方基於誠信與公平原則共同遵守。",
      "會員願意提供姓名、電話、電子郵件等聯絡資訊，以利本公司進行活動驗證、優惠訊息傳遞、課程通知與會員服務。",
      "您確認掃描 QR 填寫本問卷即表示您同意本條款內容，並願意受其約束。",
    ],
  },
  {
    title: "第二條：個資蒐集與使用授權",
    paragraphs: [
      "本公司得蒐集您於第 1 面提供之姓名、電話／手機、電子郵件（若有提供）等個人資料。",
      "本公司得使用該資料進行以下用途：\na. 活動驗證與紀錄（如入場券、獎品發放）\nb. 健身房課程、課程促銷、會員優惠活動通知\nc. 市場行銷、服務調查與滿意度回饋\nd. 會員服務相關聯繫（如館所變更、課程調整、活動公告等）",
      "本公司不會將您的個人資料作為非相關第三方商業用途之販售或轉讓，但如法律要求或司法機關提出合法需求時，本公司仍可能配合提供。",
      "若您日後欲停止接收訊息或希望撤回同意，可隨時提出申請，本公司將依據個資法規定進行處理。",
    ],
  },
  {
    title: "第三條：會員服務聯繫",
    paragraphs: [
      "為提供更完整之會員服務，您同意本公司得以您所提供之聯絡方式（包括電話、簡訊、LINE 或電子郵件）適度與您聯繫。",
      "聯繫內容可能包含：課程通知、優惠提醒、活動資訊、服務更新或續約提醒等事項。",
      "您亦可隨時透過客服或回覆訊息方式表示拒絕後續聯繫。",
    ],
  },
  {
    title: "第四條：免責條款與風險聲明",
    paragraphs: [
      "您了解並同意在參與本公司活動或進入健身場所運動時，仍存在運動傷害、跌倒、過度負荷等風險，您需自行衡量體能狀況。",
      "本公司將盡力維持設施設備之安全性與維護，但對於因不可抗力、器材老化、設備偶發故障、場地濕滑、會員操作不當等因素所致之意外或傷害，除重大故意或重大過失外，本公司不承擔連帶責任。",
      "若您因個人體質、疾病、行動不便等特殊狀況，建議您事先諮詢專業醫師是否適合參與該活動或使用特定器材；對於您未告知之健康狀況所致之風險，本公司亦不負責任。",
    ],
  },
  {
    title: "第五條：異議與爭議處理",
    paragraphs: [
      "如您對本條款或活動規定有異議，歡迎提出異議申訴，本公司將於合理期間內審查處理。",
      "本公司保留對本條款進行修改、補充之權利，修改內容將公告或以適當方式通知會員。若您不同意修改後條款，您有權選擇不接受或停止參與後續活動。",
      "本條款如有與中華民國法律或政府規定抵觸之處，以法律強制規定為準，其餘條款繼續有效。",
      "任何爭議應先友好協商解決；協商不成時，以本公司所在地管轄法院為第一審管轄法院。",
    ],
  },
  {
    title: "第六條：其他約定",
    paragraphs: [
      "本條款中如有一項或數項條款被認定為無效或不可執行，不影響其他條款之效力。",
      "您所填寫之資料以您自行負責，如因資料錯誤導致無法聯絡或獎品發放延誤，本公司得不予責任。",
      "本公司保有最終解釋權與決定權。",
    ],
  },
] as const;
