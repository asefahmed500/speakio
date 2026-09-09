import React from "react"
import Link from "next/link"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { Reveal } from "@/components/landing/reveal"

interface Skill {
  index: string
  name: string
  desc: string
  meta: string
  href: string
}

const SKILLS: Skill[] = [
  {
    index: "01",
    name: "Listening",
    desc: "Timed sections with an audio player built for exam day — auto-graded the moment you submit.",
    meta: "Auto-graded",
    href: "/skills/listening",
  },
  {
    index: "02",
    name: "Reading",
    desc: "Academic passages under a real 60-minute clock, marked server-side with answer review.",
    meta: "Auto-graded",
    href: "/skills/reading",
  },
  {
    index: "03",
    name: "Writing",
    desc: "Scored against all four official criteria by a scoring model — borderline scripts go to a human examiner.",
    meta: "AI + examiner",
    href: "/skills/writing",
  },
  {
    index: "04",
    name: "Speaking",
    desc: "Record straight from the browser. A certified examiner returns your band with structured feedback.",
    meta: "Examiner-marked",
    href: "/skills/speaking",
  },
]

export function SkillsGrid() {
  return (
    <section id="skills" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <Reveal className="flex flex-col gap-4 pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl space-y-3">
            <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              <span aria-hidden className="inline-block size-1.5 bg-primary" />
              The four skills
            </p>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              One platform, scored like the real thing
            </h2>
          </div>
          <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            Practise every part of the exam with the same scoring pipeline used on
            your final mock test.
          </p>
        </Reveal>

        <div className="border-t border-border">
          {SKILLS.map((skill, index) => (
            <Reveal key={skill.name} delay={index * 0.05} y={16}>
              <Link
                href={skill.href}
                className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border py-6 transition-colors duration-200 hover:bg-card sm:grid-cols-[3rem_10rem_1fr_auto] sm:gap-8 sm:py-7"
              >
                <span className="text-xs font-medium tabular-nums text-muted-foreground transition-colors duration-200 group-hover:text-primary">
                  {skill.index}
                </span>
                <span className="text-base font-semibold tracking-tight sm:text-lg">
                  {skill.name}
                </span>
                <span className="col-span-3 max-w-xl text-sm leading-relaxed text-muted-foreground max-sm:order-4 sm:col-span-1">
                  {skill.desc}
                </span>
                <span className="col-start-3 flex items-center gap-3 max-sm:order-3 sm:col-start-4">
                  <span className="hidden text-[11px] font-medium tracking-widest text-muted-foreground uppercase md:inline">
                    {skill.meta}
                  </span>
                  <span className="flex size-9 items-center justify-center border border-border transition-colors duration-200 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                    <ArrowUpRight className="size-4" aria-hidden />
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1} className="pt-6">
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Start with any skill
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Reveal>
      </div>
    </section>
  )
}
