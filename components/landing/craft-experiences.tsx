"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { BookOpen, FileText, Headphones, Mic, ArrowRight, Sparkles } from "lucide-react"
import { AnimatedWords, EASE, FadeUp } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

const SPRING = { type: "spring" as const, stiffness: 260, damping: 28 }

/** Shared visibility trigger — internal choreography starts on first view. */
function useInViewOnce() {
  const [started, setStarted] = useState(false)
  return {
    started,
    onViewportEnter: () => setStarted(true),
  }
}

/* ------------------------------------------------------------------ */
/* Card 01 — skill carousel (shared-element morph, spring physics)      */
/* ------------------------------------------------------------------ */

const SKILLS = [
  { name: "Listening", icon: Headphones },
  { name: "Reading", icon: BookOpen },
  { name: "Writing", icon: FileText },
  { name: "Speaking", icon: Mic },
]

function SkillCarouselCard() {
  const { started, onViewportEnter } = useInViewOnce()
  const [active, setActive] = useState(0)
  const [userSelected, setUserSelected] = useState(false)

  useEffect(() => {
    if (!started || userSelected) return
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % SKILLS.length)
    }, 2800)
    return () => window.clearInterval(id)
  }, [started, userSelected])

  return (
    <motion.div
      className="relative flex h-[585px] flex-1 flex-col overflow-hidden rounded-3xl bg-[#10192B]"
      onViewportEnter={onViewportEnter}
      viewport={{ once: true, amount: 0.2 }}
    >
      {/* Full-card scene + black/10 overlay */}
      <div className="absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2B47] via-[#10192B] to-[#0A0F1A]" />
        <div className="absolute top-[-15%] left-1/2 h-[50%] w-[80%] -translate-x-1/2 rounded-full bg-[#2B4C7E]/40 blur-[90px]" />
        <div className="absolute inset-0 bg-black/10" />
      </div>

      <div className="relative z-10 flex items-center gap-2 px-7 pt-7 text-xs tracking-[0.18em] text-white/50 uppercase">
        <span>01</span>
        <span className="h-px w-6 bg-white/25" />
        <span>Choose a skill</span>
      </div>

      {/* Vertical pill stack, positioned relative to the active item. */}
      <div className="relative z-10 flex flex-1 items-center justify-center">
        <div className="relative flex flex-col items-center gap-3">
          {SKILLS.map((skill, i) => {
            const Icon = skill.icon
            const rel = ((i - active + SKILLS.length) % SKILLS.length)
            const offset = rel > SKILLS.length / 2 ? rel - SKILLS.length : rel
            const distance = Math.abs(offset)
            const isActive = offset === 0
            return (
              <motion.button
                key={skill.name}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setActive(i)
                  setUserSelected(true)
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl px-4 backdrop-blur-md",
                  isActive
                    ? "w-[min(300px,74vw)] bg-white/25 shadow-lg shadow-black/25"
                    : "w-[min(261px,70vw)] bg-white/15"
                )}
                animate={{
                  height: isActive ? 80 : 56,
                  y: offset * 68,
                  opacity: distance >= 3 ? 0 : distance >= 2 ? 0.55 : 1,
                }}
                transition={SPRING}
              >
                <span className="flex size-9 shrink-0 items-center justify-center">
                  {isActive && (
                    <motion.span
                      layoutId="skill-orb"
                      className="flex size-9 items-center justify-center rounded-xl bg-white text-[#10192B]"
                      transition={SPRING}
                    >
                      <Icon className="size-4" />
                    </motion.span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm whitespace-nowrap text-white",
                    isActive ? "font-medium" : "text-white/75"
                  )}
                >
                  {skill.name}
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>

      <p className="relative z-10 px-7 pb-7 text-sm text-white/60">
        Four modules, one engine — each mirroring the real exam.
      </p>

      {/* Gradient masks — soften the hard edges, focus the active pill. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-28 bg-gradient-to-b from-[#10192B]/90 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-28 bg-gradient-to-t from-[#10192B]/90 to-transparent" />
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Card 02 — AI conversation (skeleton → morph → real UI)               */
/* ------------------------------------------------------------------ */

function SkeletonBars({ tone }: { tone: "light" | "dark" }) {
  return (
    <div className="space-y-2">
      <div className={cn("h-2 w-28 rounded-full", tone === "dark" ? "bg-white/15" : "bg-neutral-300")} />
      <div className={cn("h-2 w-40 rounded-full", tone === "dark" ? "bg-white/15" : "bg-neutral-300")} />
      <div className={cn("h-2 w-20 rounded-full", tone === "dark" ? "bg-white/15" : "bg-neutral-300")} />
    </div>
  )
}

function AiConversationCard() {
  const { started, onViewportEnter } = useInViewOnce()
  const [morphed, setMorphed] = useState(false)

  useEffect(() => {
    if (!started) return
    const id = window.setTimeout(() => setMorphed(true), 1100)
    return () => window.clearTimeout(id)
  }, [started])

  return (
    <motion.div
      className="relative flex h-[585px] flex-1 flex-col overflow-hidden rounded-3xl bg-[#141414] p-7 text-white"
      onViewportEnter={onViewportEnter}
      viewport={{ once: true, amount: 0.2 }}
    >
      <div className="flex items-center gap-2 text-xs tracking-[0.18em] text-white/50 uppercase">
        <span>02</span>
        <span className="h-px w-6 bg-white/25" />
        <span>AI scoring</span>
      </div>

      {/* AI message — interface loading impression. */}
      <motion.div
        className="mt-8 max-w-[75%] rounded-2xl rounded-tl-md bg-[#FAFAFA14] p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={started ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
      >
        <SkeletonBars tone="dark" />
      </motion.div>

      {/* User message — skeleton that morphs into the real message. */}
      <motion.div
        className="mt-4 ml-auto max-w-[75%] rounded-2xl rounded-tr-md p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={
          started
            ? { opacity: 1, y: 0, backgroundColor: morphed ? "#9E948B" : "#FAFAFA14" }
            : { backgroundColor: "#FAFAFA14" }
        }
        transition={{
          opacity: { duration: 0.6, delay: 0.45, ease: EASE },
          y: { duration: 0.6, delay: 0.45, ease: EASE },
          backgroundColor: { duration: 0.7, ease: EASE },
        }}
      >
        <AnimatePresence mode="wait">
          {morphed ? (
            <motion.p
              key="message"
              className="text-sm text-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              Example submission: “Score my Task 2 essay — aiming for Band 7.5.”
            </motion.p>
          ) : (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <SkeletonBars tone="dark" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="flex-1" />

      {/* Product statement — individually constructed words. */}
      <h3 className="font-display text-2xl leading-snug font-normal sm:text-[28px]">
        <AnimatedWords
          immediate
          delay={1.9}
          stagger={0.1}
          duration={0.5}
          text="Scored like an AI examiner"
        />
      </h3>

      <motion.div
        className="mt-6 flex items-center gap-4"
        initial={{ opacity: 0, y: 16 }}
        animate={started ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 2.6, ease: EASE }}
      >
        <div className="flex">
          {["1", "2", "3"].map((step, i) => (
            <span
              key={step}
              className={cn(
                "flex size-7 items-center justify-center rounded-full border border-white/25 bg-white/10 text-[11px] text-white/80",
                i > 0 && "-ml-3"
              )}
              style={{ zIndex: 3 - i }}
            >
              {step}
            </span>
          ))}
        </div>
        <span className="text-xs text-white/55">Write → AI grades → AI re-review</span>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Card 03 — adaptability (word copy + configuration rows)              */
/* ------------------------------------------------------------------ */

const CONFIG_ROWS = [
  { label: "Daily practice", value: "45 min" },
  { label: "Target band", value: "7.5+" },
  { label: "Exam date", value: "Dec 12" },
]

function AdaptabilityCard() {
  const { started, onViewportEnter } = useInViewOnce()

  return (
    <motion.div
      className="relative flex h-[585px] flex-1 flex-col overflow-hidden rounded-3xl bg-[#9E948B] p-7 text-white"
      onViewportEnter={onViewportEnter}
      viewport={{ once: true, amount: 0.2 }}
    >
      <div className="flex items-center gap-2 text-xs tracking-[0.18em] text-white/60 uppercase">
        <span>03</span>
        <span className="h-px w-6 bg-white/30" />
        <span>Adaptive plan</span>
      </div>

      <h3 className="font-display mt-8 text-2xl leading-snug font-normal sm:text-[28px]">
        Tuned to <span className="font-accent">you</span>
      </h3>

      <p className="mt-4 max-w-[32ch] text-sm leading-relaxed text-white/85">
        <AnimatedWords
          immediate
          delay={0.6}
          stagger={0.04}
          duration={0.4}
          initialY={8}
          text="Set your exam date, target band and daily commitment. Speakio builds the plan and adapts it as you improve."
        />
      </p>

      <div className="flex-1" />

      {/* Plan preview — each row opens the real study-plan settings. */}
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-x-0 -top-12 h-24 bg-gradient-to-b from-[#9E948B] to-transparent"
          aria-hidden
        />
        <div className="relative space-y-3">
          {CONFIG_ROWS.map((row, i) => (
            <motion.div
              key={row.label}
              className="flex items-center justify-between rounded-2xl bg-white p-4"
              initial={{ opacity: 0, y: 30 }}
              animate={started ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 1.1 + i * 0.18, ease: EASE }}
            >
              <Link
                href="/study-plan"
                className="flex w-full items-center justify-between text-neutral-900 hover:text-primary"
              >
                <span className="text-sm font-medium">{row.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-neutral-500">{row.value}</span>
                  <ArrowRight className="size-3.5 text-neutral-700" aria-hidden />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Section composition                                                  */
/* ------------------------------------------------------------------ */

const CARDS = [SkillCarouselCard, AiConversationCard, AdaptabilityCard]

export function CraftExperiences() {
  return (
    <section id="craft" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <FadeUp y={16} duration={0.8}>
          <p className="flex items-center justify-center gap-2 text-xs tracking-[0.2em] text-neutral-500 uppercase">
            <Sparkles className="size-3.5" aria-hidden />
            The product
          </p>
        </FadeUp>
        <FadeUp y={16} duration={0.8} delay={0.12}>
          <h2 className="font-display mx-auto mt-4 max-w-2xl text-center text-4xl leading-[1.08] font-normal tracking-[-0.02em] text-neutral-900 sm:text-5xl">
            Craft the score your <span className="font-accent">future deserves</span>
          </h2>
        </FadeUp>

        {/* Cascading three-card entrance: 0 · 0.35s · 0.7s. */}
        <div className="mt-12 flex flex-col gap-6 sm:mt-16 lg:flex-row">
          {CARDS.map((Card, index) => (
            <FadeUp
              key={index}
              y={40}
              duration={1.1}
              delay={index * 0.35}
              className="flex w-full flex-1"
            >
              <Card />
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}
