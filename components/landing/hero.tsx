"use client"

import React, { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react"
import { Menu, X } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"
import { AnimatedWords, EASE } from "@/components/landing/motion"
import { HeroMedia } from "@/components/landing/hero-media"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { label: "Skills", href: "/skills/listening" },
  { label: "Why Speakio", href: "#craft" },
  { label: "Stories", href: "#testimonials" },
]

const CAPABILITIES = ["AI Band Scoring", "Real Exam Engine", "Verifiable Certificates", "Study Planner"]

function FloatingHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  // Over the hero the nav is white-on-dark glass; past the hero (white
  // sections) it flips to a light pill so it stays visible on every section.
  const [scrolled, setScrolled] = useState(false)
  const { scrollY } = useScroll()
  // Flip just before the hero's bottom edge so the light pill never sits on
  // the dark scene, and the dark glass never sits on a white section.
  useMotionValueEvent(scrollY, "change", (value) =>
    setScrolled(value > window.innerHeight - 120)
  )

  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-50"
      initial={{ y: "45vh", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 1, ease: EASE }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-4 sm:px-6 sm:pt-5">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2.5 transition-colors duration-300",
            scrolled ? "text-neutral-900" : "text-white"
          )}
          aria-label="Speakio home"
        >
          <svg viewBox="0 0 32 32" aria-hidden className="block size-8 shrink-0">
            <rect
              width="32"
              height="32"
              rx="8"
              className={cn("transition-colors duration-300", scrolled ? "fill-primary/10" : "fill-white/15")}
            />
            <rect
              x="7.5"
              y="18"
              width="3.5"
              height="6"
              rx="1.75"
              className={cn("transition-colors duration-300", scrolled ? "fill-primary" : "fill-white")}
            />
            <rect
              x="14.25"
              y="12"
              width="3.5"
              height="12"
              rx="1.75"
              className={cn("transition-colors duration-300", scrolled ? "fill-primary" : "fill-white")}
            />
            <rect
              x="21"
              y="6.5"
              width="3.5"
              height="17.5"
              rx="1.75"
              className={cn("transition-colors duration-300", scrolled ? "fill-primary" : "fill-white")}
            />
          </svg>
          <span className="font-display text-sm font-medium tracking-tight">Speakio</span>
        </Link>

        {/* Desktop staged navigation reveal: login pill first, width expands,
            then the links fade in. */}
        <motion.nav
          className={cn(
            "hidden items-center gap-1 rounded-2xl border p-1.5 backdrop-blur-md transition-colors duration-300 md:flex",
            scrolled
              ? "border-neutral-200 bg-white/85 shadow-sm shadow-black/5"
              : "border-white/15 bg-white/10"
          )}
          style={{ overflow: "hidden" }}
          initial={{ width: 110 }}
          animate={{ width: "auto" }}
          transition={{ duration: 0.8, delay: 1.1, ease: EASE }}
          aria-label="Primary"
        >
          <motion.div
            className="flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.5, ease: EASE }}
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-sm transition-colors",
                  scrolled
                    ? "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
          </motion.div>
          <Link
            href="/login"
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
          >
            Login
          </Link>
        </motion.nav>

        {/* Mobile: circular menu toggle. */}
        <div className="relative md:hidden">
          <motion.button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={cn(
              "flex size-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors duration-300",
              scrolled
                ? "border-neutral-200 bg-white/90 text-neutral-800 shadow-sm"
                : "border-white/25 bg-white/10 text-white"
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.1 }}
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </motion.button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="absolute right-0 top-12 w-48 rounded-2xl border border-white/15 bg-[#0B0E14]/95 p-2 backdrop-blur-md"
              >
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-3.5 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 block rounded-xl bg-white px-3.5 py-2.5 text-center text-sm font-medium text-black"
                >
                  Login
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.header>
  )
}

const HEADLINE_LINES = [
  { id: "line-1", delay: 0.3, content: <>Meet Speakio.</> },
  {
    id: "line-2",
    delay: 0.5,
    content: (
      <>
        <span className="font-accent">Redefine your band</span> with
      </>
    ),
  },
  { id: "line-3", delay: 0.7, content: <>intelligent practice</> },
]

export function Hero() {
  return (
    <section className="relative min-h-svh overflow-hidden text-white">
      <HeroMedia />
      <FloatingHeader />

      <div className="relative z-10 mx-auto flex min-h-svh max-w-5xl flex-col items-center justify-center px-4 pb-28 pt-32 text-center sm:px-6">
        <h1 className="font-display text-[40px] leading-[1.02] font-normal tracking-[-0.02em] sm:text-[52px] lg:text-[64px]">
          {HEADLINE_LINES.map((line) => (
            <span key={line.id} className="block">
              <motion.span
                className="block"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: line.delay, ease: EASE }}
              >
                {line.content}
              </motion.span>
            </span>
          ))}
        </h1>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1, ease: EASE }}
        >
          <ButtonLink
            href="/register"
            className="mt-10 h-12 cursor-pointer rounded-2xl bg-white px-8 text-base font-medium text-black hover:bg-neutral-200 focus-visible:ring-white/40 lg:h-14 lg:px-10"
          >
            Start practising free
          </ButtonLink>
        </motion.div>

        {/* Flowing word-by-word supporting copy. */}
        <p className="mt-8 max-w-xl text-balance text-sm text-white/70 sm:text-base">
          <AnimatedWords
            immediate
            delay={1.15}
            stagger={0.045}
            duration={0.5}
            text="Speakio scores your writing and speaking with examiner-grade AI, simulates real exam conditions, and issues certificates anyone can verify."
          />
        </p>

        {/* Capability pills — supporting metadata, never competing with the headline. */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
          {CAPABILITIES.map((capability, i) => (
            <motion.span
              key={capability}
              className={cn(
                "rounded-2xl border border-white/40 px-4 py-2 text-xs text-white/85 sm:px-5 sm:py-2.5 sm:text-sm"
              )}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.4 + i * 0.08, ease: EASE }}
            >
              {capability}
            </motion.span>
          ))}
        </div>
      </div>
    </section>
  )
}
