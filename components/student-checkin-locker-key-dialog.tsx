"use client";

import { FormEvent, useState } from "react";
import type { StudentCheckInLockerKeySelection } from "../lib/student-checkin-entry";

type StudentCheckInLockerKeyDialogProps = {
  isSubmitting: boolean;
  error?: string;
  onConfirm: (selection: StudentCheckInLockerKeySelection) => void;
};

export function StudentCheckInLockerKeyDialog({
  isSubmitting,
  error = "",
  onConfirm,
}: StudentCheckInLockerKeyDialogProps) {
  const [lockerKeyTaken, setLockerKeyTaken] = useState<boolean | null>(null);
  const [lockerKeyNumber, setLockerKeyNumber] = useState("");
  const parsedLockerKeyNumber = Number(lockerKeyNumber);
  const hasValidLockerKeyNumber = Number.isInteger(parsedLockerKeyNumber)
    && parsedLockerKeyNumber >= 1
    && parsedLockerKeyNumber <= 12;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (lockerKeyTaken !== true) return;
    if (!hasValidLockerKeyNumber) return;
    onConfirm({ lockerKeyTaken: true, lockerKeyNumber: parsedLockerKeyNumber });
  }

  return (
    <div className="studentCheckInsApprovalBackdrop studentLockerKeyBackdrop" role="presentation">
      <section
        className="studentLockerKeyDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-locker-key-title"
      >
        <form onSubmit={submit}>
          <h2 id="student-locker-key-title">是否有拿置物櫃鑰匙？</h2>

          <div className="studentLockerKeyChoices" aria-label="是否領取置物櫃鑰匙">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                onConfirm({ lockerKeyTaken: false, lockerKeyNumber: null });
              }}
            >
              否
            </button>
            <button
              className={lockerKeyTaken === true ? "is-selected" : ""}
              type="button"
              aria-pressed={lockerKeyTaken === true}
              disabled={isSubmitting}
              onClick={() => setLockerKeyTaken(true)}
            >
              是
            </button>
          </div>

          {lockerKeyTaken === true ? (
            <label className="studentLockerKeyNumberField">
              <span>拿幾號鑰匙？</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                step={1}
                value={lockerKeyNumber}
                autoFocus
                required
                disabled={isSubmitting}
                placeholder="請輸入鑰匙號碼"
                onChange={(event) => setLockerKeyNumber(event.target.value)}
              />
              {lockerKeyNumber && !hasValidLockerKeyNumber ? <small>請輸入 1–12 的整數號碼。</small> : null}
            </label>
          ) : null}

          {lockerKeyTaken === true ? (
            <button
              className="studentLockerKeyConfirm"
              type="submit"
              disabled={isSubmitting || !hasValidLockerKeyNumber}
            >
              {isSubmitting ? "放行中…" : "確認放行"}
            </button>
          ) : null}

          {error ? <div className="studentCheckInsAdminError" role="alert">{error}</div> : null}
        </form>
      </section>
    </div>
  );
}
