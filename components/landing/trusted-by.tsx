"use client"

import React from "react"
import { motion } from "motion/react"
import { EASE } from "@/components/landing/motion"

const BRANDS = [
  "PREPKART",
  "IELTS HUB",
  "CAMPUSLANE",
  "STUDY ABROAD CO",
  "VERBAL & CO",
  "MIGRATEN",
  "BANDSQUARE",
  "ATLAS ENGLISH",
]

function BrandWordmark({ name }: { name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5 px-8 text-neutral-400 sm:px-10">
      <svg viewBox="0 0 12 12" aria-hidden className="size-2.5 fill-current">
        <path d="M6 0 L12 6 L6 12 L0 6 Z" />
      </svg>
      <span className="font-display text-sm font-medium tracking-[0.18em] whitespace-nowrap sm:text-base">
        {name}
      </span>
    </span>
  )
}

export function TrustedBy() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <motion.p
        className="text-center text-lg text-neutral-500 sm:text-xl"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        Trusted by <span className="font-accent text-neutral-900">learners worldwide</span>
      </motion.p>

      <motion.div
        className="relative mt-10 overflow-hidden sm:mt-12"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
      >
        {/* Duplicated list — seamless -50% loop with no visible gap. */}
        <div className="flex w-max animate-marquee">
          {[...BRANDS, ...BRANDS].map((brand, i) => (
            <BrandWordmark key={`${brand}-${i}`} name={brand} />
          ))}
        </div>

        {/* Soft edge masks — logos enter and dissolve instead of clipping. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent sm:w-28" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent sm:w-28" />
      </motion.div>
    </section>
  )
}
