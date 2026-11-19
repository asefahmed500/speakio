"use client"

import React from "react"
import Link from "next/link"

/**
 * One shared frame for every public form — sign in, register and verify.
 * Pure white canvas, soft white gradients, near-black text, one compact panel.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col bg-[#FAFAF8] text-[#111111]">
      <header className="relative z-10 h-14 border-b border-black/5 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
            aria-label="Speakio home"
          >
            <span className="flex size-7 items-end justify-center gap-[2px] border border-black/10 bg-white px-1.5 py-1">
              <span className="h-1.5 w-[2px] bg-[#111111]" />
              <span className="h-2.5 w-[2px] bg-[#111111]" />
              <span className="h-3.5 w-[2px] bg-[#111111]" />
            </span>
            Speakio
          </Link>
          <Link
            href="/"
            className="text-xs text-neutral-500 transition-colors hover:text-[#111111]"
          >
            Home
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 items-center px-4 py-10 sm:py-14">
        <div className="w-full bg-gradient-to-b from-white via-[#F1F1EE] to-white p-px shadow-[0_20px_60px_-30px_rgba(0,0,0,0.18)]">
          <div className="bg-white px-6 py-8 sm:px-8">
            {children}
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-black/5 bg-white/70">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4 text-[11px] text-neutral-400 sm:px-6">
          <span>&copy; {new Date().getFullYear()} Speakio</span>
          <span>IELTS practice</span>
        </div>
      </footer>
    </div>
  )
}
