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
    const serviceCard = video.closest("[data-mobile-service-card]");
    const mobileServices = window.matchMedia("(max-width: 780px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

    const applyActiveClass = () => {
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
      if (mobileServices.matches) {
        return;
      }

      clearResetTimer();
      applyActiveClass();
      void video.play().catch(() => {
        // Ignore autoplay restrictions; the fallback image remains visible.
      });
    };

    const handleMouseLeave = () => {
      if (mobileServices.matches) {
        return;
      }

      removeActiveClass();
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        pauseAndReset();
        resetTimerRef.current = null;
      }, 640);
    };

    const syncMobilePlayback = () => {
      if (!mobileServices.matches) {
        return;
      }

      clearResetTimer();

      const shouldPlay =
        serviceCard instanceof HTMLElement &&
        serviceCard.classList.contains("is-mobile-service-active") &&
        !reducedMotion.matches;

      if (shouldPlay) {
        applyActiveClass();
        void video.play().catch(() => {
          // Ignore mobile autoplay restrictions; the fallback image remains visible.
        });
        return;
      }

      removeActiveClass();
      pauseAndReset();
    };

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);

    const observer =
      serviceCard instanceof HTMLElement
        ? new MutationObserver(syncMobilePlayback)
        : null;
    observer?.observe(serviceCard as HTMLElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    mobileServices.addEventListener("change", syncMobilePlayback);
    reducedMotion.addEventListener("change", syncMobilePlayback);

    pauseAndReset();
    removeActiveClass();
    syncMobilePlayback();

    return () => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
      observer?.disconnect();
      mobileServices.removeEventListener("change", syncMobilePlayback);
      reducedMotion.removeEventListener("change", syncMobilePlayback);
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
