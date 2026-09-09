"use client"

import React from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  FileText,
  Headphones,
  Mic,
  type LucideIcon,
} from "lucide-react"
import { ButtonLink } from "@/components/ui/button"

const HERO_BANDS: Array<{ icon: LucideIcon; name: string; band: number; width: string }> = [
  { icon: Headphones, name: "Listening", band: 7.5, width: "83%" },
  { icon: BookOpen, name: "Reading", band: 8.0, width: "89%" },
  { icon: FileText, name: "Writing", band: 6.5, width: "72%" },
  { icon: Mic, name: "Speaking", band: 7.0, width: "78%" },
]

const HERO_STATS = [
  { value: "4", label: "Skills covered" },
  { value: "0.5", label: "Band precision" },
  { value: "AI + human", label: "Double-marked" },
  { value: "100%", label: "Verifiable" },
]

const EASE = [0.22, 1, 0.36, 1] as const

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

export function Hero() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(60%_50%_at_75%_0%,rgba(43,76,126,0.05),transparent_70%)]"
      />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-end gap-10 pt-14 pb-12 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* Left — editorial headline stack */}
          <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
            <motion.p
              variants={item}
              className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase"
            >
              <span aria-hidden className="inline-block size-1.5 bg-primary" />
              IELTS Academic preparation
            </motion.p>
            <motion.h1
              variants={item}
              className="max-w-xl text-balance text-4xl leading-[1.06] font-semibold tracking-tight sm:text-5xl lg:text-[3.6rem]"
            >
              Honest band scores, not guesswork.
            </motion.h1>
            <motion.p
              variants={item}
              className="max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
            >
              Real practice tests, server-side scoring and verifiable certificates —
              across all four skills.
            </motion.p>
            <motion.div variants={item} className="flex flex-wrap items-center gap-2.5 pt-1">
              <ButtonLink
                size="lg"
                className="group/cta h-11 cursor-pointer px-5 text-[0.95rem]"
                href="/register"
              >
                Start free
                <ArrowRight
                  data-icon="inline-end"
                  className="transition-transform duration-200 group-hover/cta:translate-x-0.5"
                  aria-hidden
                />
              </ButtonLink>
              <ButtonLink
                variant="outline"
                size="lg"
                className="h-11 cursor-pointer bg-card px-5 text-[0.95rem]"
                href="/login"
              >
                I have an account
              </ButtonLink>
            </motion.div>
          </motion.div>

          {/* Right — mock score report */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
          >
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="mx-auto w-full max-w-sm border border-border bg-card shadow-[0_1px_2px_rgba(28,27,24,0.05)] lg:mx-0"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <span className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
                  Score report
                </span>
                <span className="inline-flex items-center gap-1 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <BadgeCheck className="size-3" aria-hidden />
                  Sample
                </span>
              </div>
              <div className="space-y-4 px-5 py-5">
                {HERO_BANDS.map((entry) => {
                  const Icon = entry.icon
                  return (
                    <div key={entry.name} className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-background">
                        <Icon className="size-4 text-primary" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium">{entry.name}</span>
                          <span className="text-xs font-semibold tabular-nums text-primary">
                            {entry.band.toFixed(1)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 bg-muted">
                          <div className="h-full bg-primary" style={{ width: entry.width }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-baseline justify-between border-t border-border px-5 py-4">
                <span className="text-xs text-muted-foreground">Overall band</span>
                <span className="text-4xl font-semibold tracking-tight tabular-nums text-primary">
                  7.5
                </span>
              </div>
              <p className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
                Sample report —{" "}
                <Link
                  href="/verify"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  every certificate is publicly verifiable
                </Link>
              </p>
            </motion.div>
          </motion.div>
        </div>

        {/* Stats rail */}
        <motion.dl
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.45 }}
          className="grid grid-cols-2 border-t border-border sm:grid-cols-4"
        >
          {HERO_STATS.map((stat, i) => (
            <div
              key={stat.label}
              className={
                "flex flex-col gap-1 px-1 py-5 sm:px-6 " +
                (i > 0 ? "border-l border-border max-sm:[&:nth-child(3)]:border-l-0 " : "") +
                "max-sm:[&:nth-child(n+3)]:border-t max-sm:[&:nth-child(n+3)]:border-border"
              }
            >
              <dt className="order-2 text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="order-1 text-xl font-semibold tracking-tight tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  )
}
