"use client"

import React from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Reveal } from "@/components/landing/reveal"

const FAQS = [
  {
    q: "Is this an official IELTS test?",
    a: "No. Speakio is a practice platform. Certificates record participation in AI-assisted assessments with human review — they are not official test report forms.",
  },
  {
    q: "How is my writing scored?",
    a: "A scoring model evaluates your essay against the four official IELTS criteria. Results with low confidence are routed to a certified examiner before a band is published.",
  },
  {
    q: "How do certificates work?",
    a: "Complete one scored attempt in each of the four skills to issue a certificate with a public verification page anyone can check.",
  },
  {
    q: "Does speaking practice need a microphone?",
    a: "Yes. You record your response in the browser and a certified examiner reviews the recording.",
  },
]

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <Reveal className="space-y-8">
          <div className="space-y-3 text-center">
            <p className="flex items-center justify-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              <span aria-hidden className="inline-block size-1.5 bg-primary" />
              FAQ
            </p>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Frequently asked questions
            </h2>
          </div>
          <Accordion className="space-y-2.5">
            {FAQS.map((faq) => (
              <AccordionItem
                key={faq.q}
                value={faq.q}
                className="border border-border bg-card px-4 not-last:border-b"
              >
                <AccordionTrigger className="py-4 text-sm font-medium no-underline hover:no-underline">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  )
}
