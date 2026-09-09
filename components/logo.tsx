import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Speakio brand mark — a sharp square plate with an ascending
 * speech-equalizer. Pure vector, no radius, scales from favicon
 * to footer. Colors follow the design tokens via fill utilities.
 */
export function SpeakioMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={cn("block shrink-0", className)}
    >
      <rect width="32" height="32" className="fill-primary" />
      <rect x="7.5" y="18" width="3.5" height="6" className="fill-primary-foreground" />
      <rect x="14.25" y="12" width="3.5" height="12" className="fill-primary-foreground" />
      <rect x="21" y="6.5" width="3.5" height="17.5" className="fill-primary-foreground" />
    </svg>
  )
}

interface SpeakioLogoProps {
  className?: string
  markClassName?: string
  /** Optional uppercase line under the wordmark (e.g. "IELTS Academic"). */
  sublabel?: string
  href?: string
  "aria-label"?: string
}

export function SpeakioLogo({
  className,
  markClassName,
  sublabel,
  href = "/",
  "aria-label": ariaLabel = "Speakio home",
}: SpeakioLogoProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn("group/logo inline-flex items-center gap-2.5", className)}
    >
      <SpeakioMark className={cn("size-8", markClassName)} />
      <span className="flex flex-col justify-center">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          SPEAKIO
        </span>
        {sublabel && (
          <span className="text-[10px] leading-tight tracking-widest text-muted-foreground uppercase">
            {sublabel}
          </span>
        )}
      </span>
    </Link>
  )
}
