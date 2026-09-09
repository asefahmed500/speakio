import React from "react"
import Link from "next/link"
import { SpeakioLogo } from "@/components/logo"

const FOOTER_GROUPS = [
  {
    title: "Skills",
    links: [
      { label: "Listening", href: "/skills/listening" },
      { label: "Reading", href: "/skills/reading" },
      { label: "Writing", href: "/skills/writing" },
      { label: "Speaking", href: "/skills/speaking" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Create account", href: "/register" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Verify a certificate", href: "/verify" },
      { label: "Band calculator", href: "/#calculator" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-[1.2fr_repeat(3,0.6fr)]">
          <div className="space-y-4">
            <SpeakioLogo sublabel="IELTS Academic" />
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              IELTS practice &amp; assessment with honest band scores and verifiable
              certificates.
            </p>
          </div>
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title} className="space-y-3">
              <p className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
                {group.title}
              </p>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-1.5 border-t border-border pt-6 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {new Date().getFullYear()} Speakio Academic</span>
          <span>IELTS practice &amp; assessment</span>
        </div>
      </div>
    </footer>
  )
}
