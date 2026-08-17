"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./mobile-signature-pad.module.css";

export default function MobileSignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#14243a";
    context.lineWidth = 2.6;
    context.lineCap = "round";
    context.lineJoin = "round";
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
  }, [onChange]);

  useEffect(() => reset(), [reset]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = event.currentTarget.getContext("2d");
    const position = point(event);
    context?.beginPath();
    context?.moveTo(position.x, position.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    const position = point(event);
    context?.lineTo(position.x, position.y);
    context?.stroke();
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  }

  function end() {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInkRef.current) onChange(canvas.toDataURL("image/png"));
  }

  return (
    <div className={styles.pad}>
      <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="手機手寫簽名區" />
      <div><span>{hasInk ? "簽名已寫入" : "請用手指在框內簽名"}</span><button type="button" onClick={reset}>清除重簽</button></div>
    </div>
  );
}
