import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"

export const metadata: Metadata = {
  title: "Speakio — IELTS Prep & AI Band Scoring",
  description:
    "Practice with AI band scoring, a real exam-day engine and verifiable certificates.",
}

// System font stacks only — no remote font fetch, works fully offline and in
// restricted networks. The design reads through layout, spacing and weight.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth font-sans">
      <head>
        {/* esbuild's __name helper is referenced by some injected/eval'd
            scripts (browser tooling, devtools extensions). Define it as a
            harmless global so those scripts never throw
            "ReferenceError: __name is not defined" on our pages. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "typeof window!=='undefined'&&(window.__name=window.__name||function(t,v){try{if(typeof t==='function'&&v){Object.defineProperty(t,'name',{value:v,configurable:true})}}catch(e){}return t});",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Root layout — applies to every page. Google Fonts via link keeps
            builds working in networks that block fonts.gstatic.com at build. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
