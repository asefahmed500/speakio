"use client"

import React from "react"
import { Flag, ChevronLeft, ChevronRight } from "lucide-react"

interface QuestionNavStripProps {
  totalQuestions: number
  currentIndex: number
  answers: Record<string, string>
  questionIds: string[]
  flaggedIds: Set<string>
  onSelectIndex: (index: number) => void
  onToggleFlag: (questionId: string) => void
}

export function QuestionNavStrip({
  totalQuestions,
  currentIndex,
  answers,
  questionIds,
  flaggedIds,
  onSelectIndex,
  onToggleFlag,
}: QuestionNavStripProps) {
  const currentId = questionIds[currentIndex]
  const isCurrentFlagged = currentId ? flaggedIds.has(currentId) : false

  const idle = "border-black/10 bg-[#fafafa] text-black/40 hover:bg-[#f4f4f4]"

  return (
    <div className="sticky bottom-0 z-20 border-t border-black/10 bg-white/95 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => onSelectIndex(Math.max(0, currentIndex - 1))}
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-lg)] border border-black/10 bg-[#fafafa] text-black/55 hover:bg-[#f4f4f4] hover:text-black disabled:opacity-30 cursor-pointer"
            aria-label="Previous question"
          >
            <ChevronLeft className="size-4" />
          </button>

          <button
            type="button"
            disabled={currentIndex >= totalQuestions - 1}
            onClick={() => onSelectIndex(Math.min(totalQuestions - 1, currentIndex + 1))}
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-lg)] border border-black/10 bg-[#fafafa] text-black/55 hover:bg-[#f4f4f4] hover:text-black disabled:opacity-30 cursor-pointer"
            aria-label="Next question"
          >
            <ChevronRight className="size-4" />
          </button>

          {currentId && (
            <button
              type="button"
              onClick={() => onToggleFlag(currentId)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                isCurrentFlagged
                  ? "border-black bg-black text-white"
                  : "border-black/10 bg-[#fafafa] text-black/45 hover:text-black"
              }`}
            >
              <Flag className="size-3" />
              <span>{isCurrentFlagged ? "Flagged for Review" : "Flag"}</span>
            </button>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5 overflow-x-auto py-1 scrollbar-none">
          {questionIds.map((qId, idx) => {
            const hasAnswer = (answers[qId] ?? "").trim().length > 0
            const isFlagged = flaggedIds.has(qId)
            const isCurrent = idx === currentIndex

            let stateClass = idle
            if (isCurrent) {
              stateClass = "border-black bg-black text-white font-semibold"
            } else if (hasAnswer) {
              stateClass = "border-black/20 bg-[#fafafa] text-black font-medium"
            }

            return (
              <button
                key={qId}
                type="button"
                onClick={() => onSelectIndex(idx)}
                className={`relative flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-mono transition-all cursor-pointer ${stateClass}`}
                title={`Question ${idx + 1}${hasAnswer ? " (Answered)" : " (Unanswered)"}${isFlagged ? " [Flagged]" : ""}`}
              >
                {idx + 1}
                {isFlagged && (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-black" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
