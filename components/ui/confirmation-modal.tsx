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
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onCancel()
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
  }, [isOpen, isSubmitting, onCancel])

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
      aria-labelledby="confirmation-modal-title"
      aria-describedby="confirmation-modal-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-150"
        onClick={() => {
          if (!isSubmitting) onCancel()
        }}
      />

      {/* Dialog Body - Strict Zero Radius, Hairline Border */}
      <div className="relative z-50 w-full max-w-md bg-white border border-[#EDEDEA] shadow-xl p-6 transition-all animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 border ${styles.badgeClass}`}>
              {styles.icon}
            </div>
            <div>
              <h3
                id="confirmation-modal-title"
                className="font-semibold text-base text-neutral-900 leading-tight"
              >
                {title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="Close dialog"
            className="text-neutral-400 hover:text-neutral-700 disabled:opacity-50 p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        <p
          id="confirmation-modal-description"
          className="text-sm text-neutral-600 leading-relaxed mb-4"
        >
          {description}
        </p>

        {details && (
          <div className="mb-6 p-3 bg-[#FAFAF8] border border-[#EDEDEA] text-xs text-neutral-700 font-mono">
            {details}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#EDEDEA]">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onCancel}
            className="h-9 px-4 text-xs font-medium border-[#EDEDEA] text-neutral-700 hover:bg-neutral-50"
          >
            {cancelLabel}
          </Button>

          <Button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className={`h-9 px-4 text-xs font-medium ${styles.confirmBtnClass}`}
          >
            {isSubmitting ? (
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
