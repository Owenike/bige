"use client";

import { useEffect, useState } from "react";

type FloatingLineButtonProps = {
  href: string;
  ariaLabel: string;
};

export function FloatingLineButton({ href, ariaLabel }: FloatingLineButtonProps) {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    let rafId = 0;
    let lastScrollY = window.scrollY;

    const updateVisibility = () => {
      const y = window.scrollY;
      const delta = y - lastScrollY;

      if (y < 120 || delta < -2) {
        setIsHidden(false);
      } else if (delta > 3) {
        setIsHidden(true);
      }

      lastScrollY = y;
    };

    const requestFrame = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateVisibility();
      });
    };

    updateVisibility();
    window.addEventListener("scroll", requestFrame, { passive: true });
    window.addEventListener("resize", requestFrame);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", requestFrame);
      window.removeEventListener("resize", requestFrame);
    };
  }, []);

  return (
    <a
      className={`homeLuxuryLineFab${isHidden ? " homeLineFabHidden" : ""}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
    >
      LINE
    </a>
  );
}
