import React from "react"
import { ArrowRight } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"
import { Reveal } from "@/components/landing/reveal"

export function CtaSection() {
  return (
    <section className="scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <Reveal y={24}>
          <div className="relative overflow-hidden bg-primary px-6 py-16 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(255,255,255,0.10),transparent_60%)]"
            />
            <div className="relative mx-auto max-w-xl space-y-5">
              <p className="text-[11px] font-medium tracking-widest text-primary-foreground/70 uppercase">
                Free to start · no card required
              </p>
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
                Your target band is a schedule, not a wish.
              </h2>
              <div className="pt-2">
                <ButtonLink
                  size="lg"
                  className="group/cta h-11 cursor-pointer bg-card px-6 text-[0.95rem] text-primary hover:bg-primary-foreground/90"
                  href="/register"
                >
                  Create your account
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform duration-200 group-hover/cta:translate-x-0.5"
                    aria-hidden
                  />
                </ButtonLink>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
