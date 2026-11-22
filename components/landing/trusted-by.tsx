"use client"

import React from "react"
import { motion } from "motion/react"
import { EASE } from "@/components/landing/motion"

/**
 * Real platform facts — no invented "trusted by" logos or social proof.
 * Every item below is a capability implemented in the product.
 */
const CAPABILITIES = [
  "Four IELTS skills",
  "AI criterion scoring",
  "Server-timed exams",
  "Public certificate lookup",
]

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
        Everything you need in <span className="font-accent text-neutral-900">one place</span>
      </motion.p>

      <motion.div
        className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 px-4 sm:mt-12 sm:grid-cols-4 sm:px-6"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
      >
        {CAPABILITIES.map((capability) => (
          <div
            key={capability}
            className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-5 text-center text-sm font-medium text-neutral-700"
          >
            {capability}
          </div>
        ))}
      </motion.div>
    </section>
  )
}
