"use client";

import { useEffect, useRef } from "react";

type HomeHoverVideoProps = {
  src: string;
  label: string;
};

export function HomeHoverVideo({ src, label }: HomeHoverVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const card = video.closest(".homeLuxuryMediaVideoCard");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const removeActiveClass = () => {
      card.classList.remove("homeLuxuryMediaVideoCardActive");
    };

    const resetToStart = () => {
      try {
        video.currentTime = 0;
      } catch {
        // Ignore media reset issues and leave the fallback image in place.
      }
    };

    const handleMouseEnter = () => {
      card.classList.add("homeLuxuryMediaVideoCardActive");
      void video.play().catch(() => {
        // Ignore autoplay restrictions; the fallback image remains visible.
      });
    };

    const handleMouseLeave = () => {
      video.pause();
      resetToStart();
      removeActiveClass();
    };

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    handleMouseLeave();

    return () => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
      video.pause();
      resetToStart();
      removeActiveClass();
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
