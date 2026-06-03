"use client";

import { useEffect, useState } from "react";

export default function HomeIntroVideo() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!showIntro) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showIntro]);

  if (!showIntro) return null;

  const closeIntro = () => setShowIntro(false);

  return (
    <section className="homeIntroVideoOverlay" aria-label="BigE intro video">
      <video
        className="homeIntroVideoMedia"
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/home-videos/hero-poster.jpg"
        onEnded={closeIntro}
        onError={closeIntro}
      >
        <source src="/home-videos/hero-mobile.mp4" media="(max-width: 767px)" type="video/mp4" />
        <source src="/home-videos/hero-desktop.mp4" type="video/mp4" />
      </video>
      <div className="homeIntroVideoChrome">
        <span className="homeIntroVideoBrand">BigE</span>
        <button className="homeIntroVideoSkip" type="button" onClick={closeIntro}>
          跳過
        </button>
      </div>
    </section>
  );
}
