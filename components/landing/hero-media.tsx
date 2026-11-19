import React from "react"

/**
 * Self-contained cinematic media layer matching the Speakio landing page.
 * Features:
 * - Deep obsidian stage (#0B0E14)
 * - Slow-drifting ambient light orbs (#2B4C7E / #9E948B / #3D5A80)
 * - Speech-equalizer silhouette floor (the voice signature)
 * - Tactile SVG film grain
 * - Subtle black scrim
 */
export function HeroMedia({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute inset-0 pointer-events-none select-none overflow-hidden ${className}`} aria-hidden>
      <div className="absolute inset-0 bg-[#0B0E14]" />
      {/* Slow ambient light drift */}
      <div
        className="absolute inset-0 opacity-80"
        style={{ animation: "hero-drift 26s ease-in-out infinite alternate" }}
      >
        <div className="absolute -top-[20%] left-[8%] h-[70vh] w-[70vh] rounded-full bg-[#2B4C7E]/35 blur-[120px]" />
        <div className="absolute right-[4%] bottom-[-10%] h-[60vh] w-[60vh] rounded-full bg-[#9E948B]/25 blur-[110px]" />
        <div className="absolute top-[30%] left-[45%] h-[40vh] w-[40vh] rounded-full bg-[#3D5A80]/30 blur-[100px]" />
      </div>
      {/* Speech-equalizer floor */}
      <div className="absolute inset-x-0 bottom-0 flex h-[38vh] items-end justify-center gap-[1.2vw] px-[4vw] opacity-25">
        {Array.from({ length: 36 }).map((_, i) => {
          const t = Math.sin(i * 0.55) * 0.5 + 0.5
          const height = Math.round(12 + t * 82)
          const delay = Math.round(i * 14) / 100
          return (
            <div
              key={i}
              className="w-[0.4vw] rounded-full bg-gradient-to-t from-white/0 via-white/50 to-white/80"
              style={{
                height: `${height}%`,
                animation: `hero-eq 5.2s ease-in-out ${delay}s infinite alternate`,
              }}
            />
          )
        })}
      </div>
      {/* Film grain */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* Specified black/20 scrim */}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  )
}
