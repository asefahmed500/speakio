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

  return (
    <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0B0E14]/95 px-4 py-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Navigation buttons and Flag control */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => onSelectIndex(Math.max(0, currentIndex - 1))}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 cursor-pointer"
            aria-label="Previous question"
          >
            <ChevronLeft className="size-4" />
          </button>

          <button
            type="button"
            disabled={currentIndex >= totalQuestions - 1}
            onClick={() => onSelectIndex(Math.min(totalQuestions - 1, currentIndex + 1))}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 cursor-pointer"
            aria-label="Next question"
          >
            <ChevronRight className="size-4" />
          </button>

          {currentId && (
            <button
              type="button"
              onClick={() => onToggleFlag(currentId)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                isCurrentFlagged
                  ? "border-amber-400/40 bg-amber-400/20 text-amber-300"
                  : "border-white/10 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              <Flag className="size-3" />
              <span>{isCurrentFlagged ? "Flagged for Review" : "Flag"}</span>
            </button>
          )}
        </div>

        {/* Scrollable Question Number Grid */}
        <div className="flex flex-1 items-center justify-end gap-1.5 overflow-x-auto py-1 scrollbar-none">
          {questionIds.map((qId, idx) => {
            const hasAnswer = (answers[qId] ?? "").trim().length > 0
            const isFlagged = flaggedIds.has(qId)
            const isCurrent = idx === currentIndex

            let stateClass = "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
            if (isCurrent) {
              stateClass = "border-cyan-400 bg-cyan-400/20 text-cyan-300 font-bold ring-1 ring-cyan-400/50"
            } else if (hasAnswer) {
              stateClass = "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium"
            }

            return (
              <button
                key={qId}
                type="button"
                onClick={() => onSelectIndex(idx)}
                className={`relative flex size-7 shrink-0 items-center justify-center rounded-lg border text-xs font-mono transition-all cursor-pointer ${stateClass}`}
                title={`Question ${idx + 1}${hasAnswer ? " (Answered)" : " (Unanswered)"}${isFlagged ? " [Flagged]" : ""}`}
              >
                {idx + 1}
                {isFlagged && (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
