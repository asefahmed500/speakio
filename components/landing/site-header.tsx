"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useScroll, useMotionValueEvent } from "motion/react"
import { ButtonLink } from "@/components/ui/button"
import { SpeakioLogo } from "@/components/logo"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { label: "Skills", href: "/#skills" },
  { label: "How it works", href: "/#pipeline" },
  { label: "Band calculator", href: "/#calculator" },
  { label: "FAQ", href: "/#faq" },
]

export function SiteHeader() {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)

  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 8)
  })

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-200",
        scrolled
          ? "border-border bg-background/90 shadow-[0_1px_0_rgba(28,27,24,0.04)] backdrop-blur-md"
          : "border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <SpeakioLogo />

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/verify"
            className="hidden px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground lg:inline-flex"
          >
            Verify a certificate
          </Link>
          <ButtonLink variant="ghost" size="sm" className="cursor-pointer" href="/login">
            Sign in
          </ButtonLink>
          <ButtonLink size="sm" className="cursor-pointer" href="/register">
            Get started
          </ButtonLink>
        </div>
      </div>
    </header>
  )
}
