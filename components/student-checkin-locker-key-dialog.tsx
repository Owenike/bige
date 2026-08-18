"use client";

import { FormEvent, useState } from "react";
import type { StudentCheckInLockerKeySelection } from "../lib/student-checkin-entry";

type StudentCheckInLockerKeyDialogProps = {
  memberName: string;
  isSubmitting: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (selection: StudentCheckInLockerKeySelection) => void;
};

export function StudentCheckInLockerKeyDialog({
  memberName,
  isSubmitting,
  error = "",
  onCancel,
  onConfirm,
}: StudentCheckInLockerKeyDialogProps) {
  const [lockerKeyTaken, setLockerKeyTaken] = useState<boolean | null>(null);
  const [lockerKeyNumber, setLockerKeyNumber] = useState("");
  const parsedLockerKeyNumber = Number(lockerKeyNumber);
  const hasValidLockerKeyNumber = Number.isInteger(parsedLockerKeyNumber)
    && parsedLockerKeyNumber >= 1
    && parsedLockerKeyNumber <= 9999;
  const canConfirm = lockerKeyTaken === false || (lockerKeyTaken === true && hasValidLockerKeyNumber);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm || lockerKeyTaken === null) return;
    onConfirm(lockerKeyTaken
      ? { lockerKeyTaken: true, lockerKeyNumber: parsedLockerKeyNumber }
      : { lockerKeyTaken: false, lockerKeyNumber: null });
  }

  return (
    <div className="studentCheckInsApprovalBackdrop studentLockerKeyBackdrop" role="presentation">
      <section
        className="studentLockerKeyDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-locker-key-title"
        aria-describedby="student-locker-key-description"
      >
        <form onSubmit={submit}>
          <p className="studentCheckInEyebrow">LOCKER KEY</p>
          <h2 id="student-locker-key-title">是否有拿置物櫃鑰匙？</h2>
          <p id="student-locker-key-description">請確認 {memberName} 本次入場是否領取鑰匙，再完成放行。</p>

          <div className="studentLockerKeyChoices" role="radiogroup" aria-label="是否領取置物櫃鑰匙">
            <button
              className={lockerKeyTaken === false ? "is-selected" : ""}
              type="button"
              role="radio"
              aria-checked={lockerKeyTaken === false}
              disabled={isSubmitting}
              onClick={() => {
                setLockerKeyTaken(false);
                setLockerKeyNumber("");
              }}
            >
              <strong>否</strong>
              <span>沒有拿鑰匙</span>
            </button>
            <button
              className={lockerKeyTaken === true ? "is-selected" : ""}
              type="button"
              role="radio"
              aria-checked={lockerKeyTaken === true}
              disabled={isSubmitting}
              onClick={() => setLockerKeyTaken(true)}
            >
              <strong>是</strong>
              <span>有拿鑰匙</span>
            </button>
          </div>

          {lockerKeyTaken === true ? (
            <label className="studentLockerKeyNumberField">
              <span>拿幾號鑰匙？</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={9999}
                step={1}
                value={lockerKeyNumber}
                autoFocus
                required
                disabled={isSubmitting}
                placeholder="請輸入鑰匙號碼"
                onChange={(event) => setLockerKeyNumber(event.target.value)}
              />
              {lockerKeyNumber && !hasValidLockerKeyNumber ? <small>請輸入 1–9999 的整數號碼。</small> : null}
            </label>
          ) : null}

          {error ? <div className="studentCheckInsAdminError" role="alert">{error}</div> : null}

          <div className="studentLockerKeyActions">
            <button className="studentCheckInsRejectButton" type="button" disabled={isSubmitting} onClick={onCancel}>返回</button>
            <button className="studentCheckInsApproveButton" type="submit" disabled={isSubmitting || !canConfirm}>
              {isSubmitting ? "處理中" : "確認放行"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
