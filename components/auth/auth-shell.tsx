import React from "react"
import Link from "next/link"
import { SpeakioLogo } from "@/components/logo"

/**
 * Shared chrome for public account pages (sign in, register, verify).
 * Keeps the brand header/footer consistent across the auth journeys.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col justify-between bg-surface-subtle font-sans text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <SpeakioLogo />
        <Link
          href="/"
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to home
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center p-4 sm:p-6 md:p-10">
        {children}
      </div>

      <footer className="flex h-12 items-center justify-between border-t border-border bg-card px-4 text-[11px] text-muted-foreground sm:px-6">
        <span>&copy; {new Date().getFullYear()} Speakio Academic</span>
        <span>IELTS practice &amp; assessment</span>
      </footer>
    </div>
  )
}
