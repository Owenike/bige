"use client";

import { useEffect, useRef } from "react";

type HomeHoverVideoProps = {
  src: string;
  label: string;
};

export function HomeHoverVideo({ src, label }: HomeHoverVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const card = video.closest(".homeLuxuryMediaVideoCard");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const grid = card.closest(".homeLuxuryShowcaseVideoGrid");

    const getActiveCardValue = (): "s2a" | "s2b" | "s2c" | "s2d" | null => {
      if (card.classList.contains("homeLuxuryMediaS2A")) {
        return "s2a";
      }
      if (card.classList.contains("homeLuxuryMediaS2B")) {
        return "s2b";
      }
      if (card.classList.contains("homeLuxuryMediaS2C")) {
        return "s2c";
      }
      if (card.classList.contains("homeLuxuryMediaS2D")) {
        return "s2d";
      }
      return null;
    };

    const removeActiveClass = () => {
      card.classList.remove("homeLuxuryMediaVideoCardActive");

      if (grid instanceof HTMLElement) {
        grid.classList.remove("homeLuxuryShowcaseVideoGridActive");
        grid.removeAttribute("data-active-card");
      }
    };

    const resetToStart = () => {
      try {
        video.currentTime = 0;
      } catch {
        // Ignore media reset issues and leave the fallback image in place.
      }
    };

    const clearResetTimer = () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };

    const pauseAndReset = () => {
      video.pause();
      resetToStart();
    };

    const handleMouseEnter = () => {
      clearResetTimer();
      card.classList.add("homeLuxuryMediaVideoCardActive");

      if (grid instanceof HTMLElement) {
        const activeCard = getActiveCardValue();
        grid.classList.add("homeLuxuryShowcaseVideoGridActive");
        if (activeCard) {
          grid.setAttribute("data-active-card", activeCard);
        } else {
          grid.removeAttribute("data-active-card");
        }
      }

      void video.play().catch(() => {
        // Ignore autoplay restrictions; the fallback image remains visible.
      });
    };

    const handleMouseLeave = () => {
      removeActiveClass();
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        pauseAndReset();
        resetTimerRef.current = null;
      }, 640);
    };

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    pauseAndReset();
    removeActiveClass();

    return () => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
      clearResetTimer();
      removeActiveClass();
      pauseAndReset();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="homeLuxuryMediaVideo"
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      data-video-label={label}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
