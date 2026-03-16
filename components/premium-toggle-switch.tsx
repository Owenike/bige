"use client";

import styles from "./premium-toggle-switch.module.css";

type PremiumToggleSwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function PremiumToggleSwitch(props: PremiumToggleSwitchProps) {
  return (
    <label className={[styles.root, props.className].filter(Boolean).join(" ")}>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        data-checked={props.checked}
        className={styles.button}
        onClick={() => {
          if (!props.disabled) props.onCheckedChange(!props.checked);
        }}
        disabled={props.disabled}
      >
        <span className={styles.thumb} />
      </button>
      <span className={styles.meta}>
        <span className={styles.label}>{props.label}</span>
        {props.description ? <span className={styles.description}>{props.description}</span> : null}
      </span>
    </label>
  );
}
