"use client"

import React from "react"
import { motion, type Variants } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * The single motion language for the whole page.
 * MICRO 0.2–0.3s · CONTENT 0.5–0.9s · CINEMATIC 0.9–1.2s.
 */
export const EASE = [0.22, 1, 0.36, 1] as const

export const VIEWPORT = { once: true, amount: 0.2 } as const

interface FadeUpProps {
  children: React.ReactNode
  className?: string
  /** CINEMATIC reveal (default 1.1s) — use ~0.6s for plain content. */
  duration?: number
  delay?: number
  y?: number
  /** Animate on mount instead of when scrolled into view. */
  immediate?: boolean
}

/** Scroll-triggered fade-and-rise. The workhorse CONTENT/CINEMATIC reveal. */
export function FadeUp({
  children,
  className,
  duration = 1.1,
  delay = 0,
  y = 40,
  immediate = false,
}: FadeUpProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={immediate ? undefined : { opacity: 1, y: 0 }}
      animate={immediate ? { opacity: 1, y: 0 } : undefined}
      viewport={immediate ? undefined : VIEWPORT}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

interface AnimatedWordsProps {
  text: string
  className?: string
  wordClassName?: string
  /** Delay before the first word. */
  delay?: number
  /** Per-word increment. */
  stagger?: number
  duration?: number
  initialY?: number
  /** Animate on mount instead of when scrolled into view. */
  immediate?: boolean
}

/**
 * Splits a paragraph into words and reveals each one with an incremental
 * delay — the flowing-sentence primitive used by the hero description,
 * card copy and the testimonial quote.
 */
export function AnimatedWords({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.045,
  duration = 0.5,
  initialY = 10,
  immediate = false,
}: AnimatedWordsProps) {
  const words = text.split(" ")
  const animation = { opacity: 1, y: 0 }
  const common = {
    initial: { opacity: 0, y: initialY },
    transition: { duration, ease: EASE },
  }
  return (
    <span className={className} aria-label={text} role="text">
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          aria-hidden
          className={cn("inline-block mr-[0.25em]", wordClassName)}
          {...common}
          {...(immediate
            ? { animate: animation, transition: { ...common.transition, delay: delay + i * stagger } }
            : {
                whileInView: animation,
                viewport: VIEWPORT,
                transition: { ...common.transition, delay: delay + i * stagger },
              })}
        >
          {word}
        </motion.span>
      ))}
    </span>
  )
}

const staggerContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.18 } },
}

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

/** Parent-level coordinated entrance (staggerChildren: 0.18). */
export function StaggerContainer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={className}
      variants={staggerContainerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div className={className} variants={staggerItemVariants}>
      {children}
    </motion.div>
  )
}

/** Rounded media container with a subtle scroll entrance — no aggressive zoom. */
export function MaskedImage({
  src,
  alt,
  className,
  imageClassName,
}: {
  src: string
  alt: string
  className?: string
  imageClassName?: string
}) {
  return (
    <FadeUp y={24} duration={0.9}>
      <div className={cn("overflow-hidden rounded-2xl", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={cn("h-full w-full object-cover", imageClassName)}
        />
      </div>
    </FadeUp>
  )
}
