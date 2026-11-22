import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Exam draft persistence (crash/refresh recovery for the active attempt).
 * The server attempt record remains the source of truth for grading; this
 * store only protects in-flight answers against accidental loss.
 */
export interface ExamAnswer {
  questionId: string
  answer: string
  isFlagged?: boolean
}

interface ExamDraftState {
  attemptId: string | null
  essayText: string
  wordCount: number
  answers: Record<string, ExamAnswer>
  flaggedIds: string[]
  savedAt: number | null

  setAttemptId: (attemptId: string | null) => void
  setEssayText: (text: string) => void
  setAnswer: (questionId: string, answer: string) => void
  toggleFlag: (questionId: string) => void
  markSaved: () => void
  clearExamDraft: () => void
}

export const useExamStore = create<ExamDraftState>()(
  persist(
    (set) => ({
      attemptId: null,
      essayText: "",
      wordCount: 0,
      answers: {},
      flaggedIds: [],
      savedAt: null,

      setAttemptId: (attemptId) => set({ attemptId }),
      setEssayText: (text) => {
        const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
        set({ essayText: text, wordCount: words })
      },
      setAnswer: (questionId, answer) =>
        set((state) => ({
          answers: {
            ...state.answers,
            [questionId]: {
              questionId,
              answer,
              isFlagged: state.answers[questionId]?.isFlagged || false,
            },
          },
        })),
      toggleFlag: (questionId) =>
        set((state) => ({
          flaggedIds: state.flaggedIds.includes(questionId)
            ? state.flaggedIds.filter((id) => id !== questionId)
            : [...state.flaggedIds, questionId],
        })),
      markSaved: () => set({ savedAt: Date.now() }),
      clearExamDraft: () =>
        set({ attemptId: null, essayText: "", wordCount: 0, answers: {}, flaggedIds: [], savedAt: null }),
    }),
    {
      name: "speakio-exam-draft-v2",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    }
  )
)
