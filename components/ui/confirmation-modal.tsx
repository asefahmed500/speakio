"use client"

import * as React from "react"
import { AlertTriangle, AlertCircle, Info, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export type ConfirmationIntent = "destructive" | "warning" | "info" | "success"

export interface ConfirmationModalProps {
  isOpen: boolean
  title: string
  description: string
  intent?: ConfirmationIntent
  confirmLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  details?: React.ReactNode
  /** Operation error, shown inside the dialog so the user can retry in place. */
  error?: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmationModal({
  isOpen,
  title,
  description,
  intent = "destructive",
  confirmLabel = "Confirm Action",
  cancelLabel = "Cancel",
  isSubmitting = false,
  details,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const uid = React.useId()
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const [busy, setBusy] = React.useState(false)
  const working = isSubmitting || busy

  React.useEffect(() => {
    if (!isOpen) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    // Focus the safe (Cancel) action first for destructive confirmations.
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>('[data-modal-cancel]')?.focus()
    return () => {
      returnFocusRef.current?.focus()
    }
  }, [isOpen])

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === "Escape" && !working) {
        onCancel()
        return
      }
      if (e.key === "Tab") {
        // Keep focus inside the dialog while it is open.
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable || focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    if (isOpen) {
      document.body.style.overflow = "hidden"
      window.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.body.style.overflow = "unset"
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, working, onCancel])

  const handleConfirm = async () => {
    if (working) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) return null

  const getIntentStyles = () => {
    switch (intent) {
      case "destructive":
        return {
          icon: <AlertTriangle className="size-5 text-red-600" />,
          badgeClass: "bg-red-50 text-red-700 border-red-200",
          confirmVariant: "destructive" as const,
          confirmBtnClass: "bg-red-600 hover:bg-red-700 text-white",
        }
      case "warning":
        return {
          icon: <AlertCircle className="size-5 text-amber-600" />,
          badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
          confirmVariant: "default" as const,
          confirmBtnClass: "bg-amber-600 hover:bg-amber-700 text-white",
        }
      case "success":
        return {
          icon: <Info className="size-5 text-emerald-600" />,
          badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
          confirmVariant: "default" as const,
          confirmBtnClass: "bg-emerald-600 hover:bg-emerald-700 text-white",
        }
      case "info":
      default:
        return {
          icon: <Info className="size-5 text-neutral-800" />,
          badgeClass: "bg-neutral-100 text-neutral-800 border-neutral-200",
          confirmVariant: "default" as const,
          confirmBtnClass: "bg-neutral-900 hover:bg-black text-white",
        }
    }
  }

  const styles = getIntentStyles()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-150"
        onClick={() => {
          if (!working) onCancel()
        }}
      />

      {/* Dialog Body - Strict Zero Radius, Hairline Border */}
      <div
        ref={panelRef}
        className="relative z-50 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-white border border-[#EDEDEA] shadow-xl p-6 transition-all animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 border ${styles.badgeClass}`}>
              {styles.icon}
            </div>
            <div>
              <h3
                id={titleId}
                className="font-semibold text-base text-neutral-900 leading-tight"
              >
                {title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            disabled={working}
            onClick={onCancel}
            aria-label="Close dialog"
            className="text-neutral-400 hover:text-neutral-700 disabled:opacity-50 p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        <p
          id={descId}
          className="text-sm text-neutral-600 leading-relaxed mb-4"
        >
          {description}
        </p>

        {details && (
          <div className="mb-6 p-3 bg-[#FAFAF8] border border-[#EDEDEA] text-xs text-neutral-700 font-mono">
            {details}
          </div>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#EDEDEA]">
          <Button
            type="button"
            data-modal-cancel
            variant="outline"
            disabled={working}
            onClick={onCancel}
            className="h-9 px-4 text-xs font-medium border-[#EDEDEA] text-neutral-700 hover:bg-neutral-50"
          >
            {cancelLabel}
          </Button>

          <Button
            type="button"
            disabled={working}
            onClick={() => void handleConfirm()}
            className={`h-9 px-4 text-xs font-medium ${styles.confirmBtnClass}`}
          >
            {working ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
