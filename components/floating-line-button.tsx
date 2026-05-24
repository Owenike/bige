"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const LINE_URL = "https://lin.ee/0GWm0oZ";

export function FloatingActionButtons() {
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
    <nav className={`homeLuxuryFloatingActions${isHidden ? " homeLineFabHidden" : ""}`} aria-label="BigE 快捷操作">
      <Link className="homeLuxuryFloatingAction homeLuxuryFloatingHome" href="/" aria-label="返回首頁">
        <Image
          src="/LOGO-transparent-floating.png"
          alt=""
          width={561}
          height={1019}
          className="homeLuxuryFloatingLogo"
          aria-hidden
        />
        <span className="homeLuxuryFloatingHomeDivider" aria-hidden />
        <span className="homeLuxuryFloatingHomeText">首頁</span>
      </Link>
      <Link
        className="homeLuxuryFloatingAction homeLuxuryFloatingBooking"
        href="/trial-booking"
        aria-label="立即預約首次體驗"
      >
        <span>立即</span>
        <span>預約</span>
      </Link>
      <a
        className="homeLuxuryFloatingAction homeLuxuryFloatingLine"
        href={LINE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="LINE 諮詢"
      >
        LINE
      </a>
    </nav>
  );
}
