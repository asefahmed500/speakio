import React from "react"
import { ArrowRight, BadgeCheck } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"
import { Reveal } from "@/components/landing/reveal"

export function Verification() {
  return (
    <section className="scroll-mt-24 border-y border-border bg-card">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <Reveal className="space-y-4">
          <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            <span aria-hidden className="inline-block size-1.5 bg-primary" />
            Certificates
          </p>
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Every certificate is verifiable
          </h2>
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            Each certificate carries a public verification code. Anyone — a
            university, employer or friend — can check its status in seconds.
          </p>
          <div className="pt-1">
            <ButtonLink
              variant="outline"
              className="group/cta cursor-pointer bg-card"
              href="/verify"
            >
              Verify a certificate
              <ArrowRight
                data-icon="inline-end"
                className="transition-transform duration-200 group-hover/cta:translate-x-0.5"
                aria-hidden
              />
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={0.1} y={20}>
          <ol className="mx-auto w-full max-w-sm lg:mx-0">
            {[
              {
                step: "1",
                title: "You complete all four skills",
                body: "A certificate is issued automatically with a unique verification code.",
              },
              {
                step: "2",
                title: "You share the link or code",
                body: "The code prints on the certificate and rides on every shareable link.",
              },
              {
                step: "3",
                title: "Anyone can confirm it",
                body: "A public page shows the band, issue date and status — valid or revoked — in seconds.",
              },
            ].map((item) => (
              <li
                key={item.step}
                className="flex gap-4 border border-border bg-card p-5 not-first:border-t-0"
              >
                <span className="flex size-8 shrink-0 items-center justify-center bg-primary text-xs font-semibold text-primary-foreground">
                  {item.step}
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-tight">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mx-auto mt-3 flex max-w-sm items-center gap-1.5 text-[11px] text-muted-foreground lg:mx-0">
            <BadgeCheck className="size-3.5 text-success" aria-hidden />
            Revoked certificates are flagged publicly, immediately.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
