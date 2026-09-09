"use client"

import React, { useMemo, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Reveal } from "@/components/landing/reveal"

function roundToBand(value: number): number {
  return Math.round(Math.min(9, Math.max(0, value)) * 2) / 2
}

function cefrFor(band: number): string {
  if (band >= 8.5) return "C2"
  if (band >= 7.0) return "C1"
  if (band >= 5.5) return "B2"
  if (band >= 4.5) return "B1"
  return "A2"
}

const SKILL_KEYS = [
  ["listening", "Listening"],
  ["reading", "Reading"],
  ["writing", "Writing"],
  ["speaking", "Speaking"],
] as const

type SkillKey = (typeof SKILL_KEYS)[number][0]

export function BandCalculator() {
  const [sliders, setSliders] = useState<Record<SkillKey, number>>({
    listening: 7,
    reading: 7,
    writing: 6.5,
    speaking: 7,
  })

  const overall = useMemo(() => {
    const avg =
      (sliders.listening + sliders.reading + sliders.writing + sliders.speaking) / 4
    return roundToBand(avg)
  }, [sliders])

  return (
    <section id="calculator" className="scroll-mt-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <Reveal className="space-y-4">
          <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            <span aria-hidden className="inline-block size-1.5 bg-primary" />
            Band calculator
          </p>
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Estimate your overall band
          </h2>
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            Move the sliders to estimate your overall band. The overall score is the
            mean of the four skills, rounded to the nearest half band.
          </p>
          <p className="inline-flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            Approximate CEFR level
            <span className="font-semibold text-primary">{cefrFor(overall)}</span>
          </p>
        </Reveal>
        <Reveal delay={0.1} y={20}>
          <div className="border border-border bg-card p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] sm:p-6">
            <div className="space-y-5">
              {SKILL_KEYS.map(([key, label]) => (
                <div key={key} className="flex items-center gap-4">
                  <span className="w-20 shrink-0 text-xs font-medium">{label}</span>
                  <Slider
                    value={sliders[key]}
                    min={4}
                    max={9}
                    step={0.5}
                    aria-label={`${label} band`}
                    onValueChange={(value) =>
                      setSliders((s) => ({ ...s, [key]: Number(value) }))
                    }
                    className="flex-1"
                  />
                  <span className="w-9 text-right text-sm font-semibold tabular-nums text-primary">
                    {sliders[key].toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-baseline justify-between border-t border-border pt-5">
              <span className="text-xs text-muted-foreground">Overall band</span>
              <span className="text-5xl font-semibold tracking-tight tabular-nums text-primary">
                {overall.toFixed(1)}
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
