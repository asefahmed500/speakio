"use client"

import React from "react"
import Link from "next/link"
import { ArrowRight, Check, ShieldCheck } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"
import { AnimatedWords, StaggerContainer, StaggerItem } from "@/components/landing/motion"

/**
 * Abstract editorial portrait — a voice rendered as a waveform over warm
 * paper. Self-contained (no external media) and on-brand for a speaking
 * product.
 */
function VoicePortrait() {
  const bars = [
    [46, 88], [52, 64], [58, 104], [64, 52], [70, 96], [76, 140],
    [82, 76], [88, 118], [94, 58], [100, 92], [106, 132], [112, 70],
    [118, 100], [124, 148], [130, 84], [136, 112], [142, 60], [148, 96],
  ]
  return (
    <svg
      viewBox="0 0 320 240"
      className="h-full w-full"
      role="img"
      aria-label="Abstract voice waveform portrait"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="tp-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#EFEAE2" />
          <stop offset="100%" stopColor="#DBD2C3" />
        </linearGradient>
      </defs>
      <rect width="320" height="240" fill="url(#tp-paper)" />
      {[70, 110, 150].map((r) => (
        <circle key={r} cx="160" cy="240" r={r} fill="none" stroke="#2B4C7E" strokeOpacity="0.14" strokeWidth="1" />
      ))}
      <g fill="#2B4C7E">
        {bars.map(([x, h], i) => (
          <rect
            key={x}
            x={x}
            y={150 - h / 2}
            width="3"
            height={h}
            rx="1.5"
            opacity={0.25 + (i % 5) * 0.11}
          />
        ))}
      </g>
      <rect x="18" y="18" width="40" height="40" rx="12" fill="#FFFFFF" opacity="0.9" />
      <g fill="#2B4C7E">
        <rect x="28" y="33" width="4" height="10" rx="2" />
        <rect x="36" y="27" width="4" height="22" rx="2" />
        <rect x="44" y="22" width="4" height="32" rx="2" />
      </g>
    </svg>
  )
}

const PROOF_POINTS = [
  "Every band is scored against the four published IELTS criteria",
  "Writing and speaking are reviewed by a second AI pass before publishing",
  "Each certificate carries a code anyone can verify without an account",
]

/**
 * Product-fact section (formerly a fabricated testimonial). All statements
 * below describe behaviour that is actually implemented in the app.
 */
export function Testimonials() {
  return (
    <section id="verify" className="bg-white py-20 sm:py-28">
      <StaggerContainer className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div className="flex flex-col">
          <StaggerItem>
            <h2 className="font-display text-3xl leading-[1.12] font-normal tracking-[-0.02em] text-neutral-900 sm:text-4xl">
              Honest scores,{" "}
              <span className="font-accent">verifiable proof</span>
            </h2>
          </StaggerItem>
          <StaggerItem>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-500">
              Speakio is built around the four IELTS skills, the same assessment criteria
              examiners use, and a completion certificate you can prove is real.
            </p>
          </StaggerItem>
          <StaggerItem>
            <ButtonLink
              href="/register"
              className="mt-6 h-12 cursor-pointer self-start rounded-2xl bg-black px-6 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Create your account
              <ArrowRight className="ml-1 size-4" aria-hidden />
            </ButtonLink>
          </StaggerItem>

          <StaggerItem className="mt-10 lg:mt-auto lg:pt-12">
            <div className="h-[280px] overflow-hidden rounded-2xl sm:h-[351px]">
              <VoicePortrait />
            </div>
            <div className="mt-4 rounded-2xl bg-[#F1F0EF] px-6 py-7 text-center">
              <p className="font-display text-sm font-bold tracking-[0.3em] text-neutral-900">
                SPEAKIO
              </p>
              <p className="mt-1 text-[10px] tracking-[0.3em] text-neutral-500 uppercase">
                IELTS Academic
              </p>
            </div>
          </StaggerItem>
        </div>

        <div className="flex flex-col justify-center">
          <StaggerItem>
            <blockquote className="text-2xl leading-[1.35] font-normal tracking-[-0.01em] text-neutral-900 sm:text-[32px]">
              <AnimatedWords
                delay={0.4}
                stagger={0.04}
                duration={0.35}
                initialY={6}
                text="Practice under exam conditions, see where you actually stand, and finish with a certificate that can be checked by anyone."
              />
            </blockquote>
          </StaggerItem>
          <StaggerItem>
            <ul className="mt-8 space-y-3">
              {PROOF_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-neutral-600">
                  <Check className="mt-0.5 size-4 shrink-0 text-neutral-900" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </StaggerItem>
          <StaggerItem>
            <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-6">
              <span className="flex items-center gap-2 text-xs font-medium text-neutral-900">
                <ShieldCheck className="size-4" aria-hidden /> Public verification
              </span>
              <Link
                href="/verify"
                className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                Look up a certificate →
              </Link>
            </div>
          </StaggerItem>
        </div>
      </StaggerContainer>
    </section>
  )
}
