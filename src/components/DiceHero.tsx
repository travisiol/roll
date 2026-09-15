"use client";

import { useEffect, useRef } from "react";
import { mountDice } from "@/lib/three/dice";

/**
 * The glass dice. A flat SVG stands in until the first WebGL frame, then
 * hides itself from the render loop (an `hidden` flip, not React state).
 */
export function DiceHero({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: ReturnType<typeof mountDice> | undefined;
    try {
      handle = mountDice(canvas, () => {
        if (fallbackRef.current) fallbackRef.current.style.display = "none";
        canvas.style.opacity = "1";
      });
    } catch {
      /* no WebGL: the SVG stays */
    }
    return () => handle?.dispose();
  }, []);

  return (
    <div className={`relative ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-500" />
      <svg ref={fallbackRef} viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" fill="none">
        <rect x="90" y="80" width="120" height="120" rx="18" stroke="#d6d6dc" strokeOpacity="0.5" />
        <circle cx="120" cy="110" r="7" fill="#e3132b" />
        <circle cx="180" cy="110" r="7" fill="#e3132b" />
        <circle cx="150" cy="140" r="7" fill="#e3132b" />
        <circle cx="120" cy="170" r="7" fill="#e3132b" />
        <circle cx="180" cy="170" r="7" fill="#e3132b" />
        <rect x="230" y="110" width="100" height="100" rx="16" stroke="#d6d6dc" strokeOpacity="0.5" fill="#17171b" />
        <circle cx="255" cy="135" r="6" fill="#d6d6dc" />
        <circle cx="305" cy="185" r="6" fill="#d6d6dc" />
      </svg>
    </div>
  );
}
