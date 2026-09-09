import React from "react"
import {
  ClipboardList,
  ScanSearch,
  Award,
  type LucideIcon,
} from "lucide-react"
import { Reveal } from "@/components/landing/reveal"

interface Step {
  icon: LucideIcon
  step: string
  title: string
  desc: string
}

const STEPS: Step[] = [
  {
    icon: ClipboardList,
    step: "Step 1",
    title: "Sit the test",
    desc: "Timed sections for every skill — real exam conditions, right in the browser.",
  },
  {
    icon: ScanSearch,
    step: "Step 2",
    title: "Get your band",
    desc: "Listening and reading are graded server-side. Writing and speaking are scored by a model, then confirmed by an examiner when it matters.",
  },
  {
    icon: Award,
    step: "Step 3",
    title: "Prove it",
    desc: "Complete all four skills and a verifiable certificate is issued with a public link anyone can check.",
  },
]

export function Pipeline() {
  return (
    <section id="pipeline" className="scroll-mt-24 border-y border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <Reveal className="max-w-xl space-y-3 pb-12">
          <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            <span aria-hidden className="inline-block size-1.5 bg-primary" />
            How it works
          </p>
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            From practice to proof
          </h2>
        </Reveal>

        <ol className="grid grid-cols-1 gap-px border border-border bg-border md:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            return (
              <Reveal key={step.title} delay={index * 0.08} y={16} className="h-full">
                <li className="flex h-full flex-col gap-4 bg-card p-6 sm:p-8">
                  <div className="flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center border border-border bg-background">
                      <Icon className="size-[18px] text-primary" aria-hidden />
                    </span>
                    <span className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
                      {step.step}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </li>
              </Reveal>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
