"use client"

import React, { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { apiFetch } from "@/lib/api-client"

interface ManagedSet {
  id: string
  title: string
  skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "FULL_MOCK"
  moduleType: string
  timeLimitMinutes: number
  questionCount: number
  attemptsCount: number
  createdAt: string
}

interface FullQuestion {
  id: string
  partNumber: number
  questionType: string
  prompt: string
  passage: string | null
  orderIndex: number
  options: string[] | null
  correctAnswer: string | null
  acceptedAnswers: string[] | null
}

interface FullSet extends ManagedSet {
  questions: FullQuestion[]
}

const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const
const SKILL_BADGE: Record<string, string> = {
  LISTENING: "border-primary/30 bg-primary/10 text-primary",
  READING: "border-emerald-700/30 bg-emerald-700/10 text-emerald-800",
  WRITING: "border-warning/30 bg-warning/10 text-warning",
  SPEAKING: "border-purple-600/30 bg-purple-600/10 text-purple-700",
  FULL_MOCK: "border-border bg-surface-subtle text-muted-foreground",
}

export default function QuestionBankPage() {
  const [sets, setSets] = useState<ManagedSet[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [fullSet, setFullSet] = useState<FullSet | null>(null)
  const [fullLoading, setFullLoading] = useState(false)

  const [genSkill, setGenSkill] = useState<(typeof SKILLS)[number]>("READING")
  const [genTopic, setGenTopic] = useState("")
  const [genCount, setGenCount] = useState("10")
  const [generating, setGenerating] = useState(false)

  const [topUpBusy, setTopUpBusy] = useState<string | null>(null)
  const [deleteSetTarget, setDeleteSetTarget] = useState<ManagedSet | null>(null)
  const [deletingSet, setDeletingSet] = useState(false)
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<FullQuestion | null>(null)
  const [deletingQuestion, setDeletingQuestion] = useState(false)

  // Manual add-question form state (per expanded set)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newType, setNewType] = useState<"MCQ" | "COMPLETION" | "ESSAY" | "SPEAKING_PROMPT">("MCQ")
  const [newPrompt, setNewPrompt] = useState("")
  const [newPassage, setNewPassage] = useState("")
  const [newOptions, setNewOptions] = useState(["", "", "", ""])
  const [newCorrect, setNewCorrect] = useState("")
  const [newAccepted, setNewAccepted] = useState("")
  const [addingBusy, setAddingBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const fetchSets = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await apiFetch<ManagedSet[]>("/tests/manage")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the question bank.")
      setSets(null)
    } else {
      setSets(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchSets()
    })
    return () => {
      active = false
    }
  }, [fetchSets])

  const loadSet = useCallback(async (id: string) => {
    setExpandedId(id)
    setFullLoading(true)
    setFullSet(null)
    setShowAddForm(false)
    const { data, error: fetchError } = await apiFetch<FullSet>(`/tests/${id}/full`)
    setFullLoading(false)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the set.")
      return
    }
    setFullSet(data)
  }, [])

  const openSet = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setFullSet(null)
      return
    }
    await loadSet(id)
  }

  const generateNewSet = async () => {
    setGenerating(true)
    setError(null)
    setNotice(null)
    const count = Math.max(3, Math.min(20, Number(genCount) || 10))
    const { data, error: genError } = await apiFetch<{
      created: number
      testSetTitle: string
      duplicatesSkipped: number
    }>("/tests/generate", {
      method: "POST",
      json: { mode: "ai", skill: genSkill, count, topic: genTopic || undefined },
      timeoutMs: 0, // AI generation of up to 20 questions
    })
    setGenerating(false)
    if (genError || !data) {
      setError(genError?.message ?? "Generation failed.")
      return
    }
    setNotice(`AI wrote ${data.created} new ${genSkill} questions into “${data.testSetTitle}”.`)
    void fetchSets()
  }

  const topUpSet = async (set: ManagedSet) => {
    setTopUpBusy(set.id)
    setError(null)
    setNotice(null)
    const { data, error: genError } = await apiFetch<{ created: number }>(
      `/tests/${set.id}/questions/generate`,
      { method: "POST", json: { count: 5 }, timeoutMs: 0 },
    )
    setTopUpBusy(null)
    if (genError || !data) {
      setError(genError?.message ?? "Generation failed.")
      return
    }
    setNotice(`AI added ${data.created} questions to “${set.title}”.`)
    if (expandedId === set.id) await loadSet(set.id)
    void fetchSets()
  }

  const deleteSet = async () => {
    if (!deleteSetTarget) return
    setDeletingSet(true)
    setDeleteError(null)
    const { error: delError } = await apiFetch(`/tests/${deleteSetTarget.id}`, { method: "DELETE" })
    setDeletingSet(false)
    if (delError) {
      // Keep the dialog open so the admin sees the real error and can retry.
      setDeleteError(delError.message)
      return
    }
    setNotice(`Deleted “${deleteSetTarget.title}”.`)
    setDeleteSetTarget(null)
    if (expandedId === deleteSetTarget.id) {
      setExpandedId(null)
      setFullSet(null)
    }
    void fetchSets()
  }

  const deleteQuestion = async () => {
    if (!deleteQuestionTarget || !fullSet) return
    setDeletingQuestion(true)
    setDeleteError(null)
    const { error: delError } = await apiFetch(
      `/tests/${fullSet.id}/questions/${deleteQuestionTarget.id}`,
      { method: "DELETE" },
    )
    setDeletingQuestion(false)
    if (delError) {
      setDeleteError(delError.message)
      return
    }
    setNotice("Question removed.")
    setDeleteQuestionTarget(null)
    await loadSet(fullSet.id)
    void fetchSets()
  }

  const addQuestionManually = async () => {
    if (!fullSet) return
    setAddingBusy(true)
    setAddError(null)
    const payload: Record<string, unknown> = {
      questionType: newType,
      prompt: newPrompt,
      passage: newPassage || undefined,
      partNumber: newType === "ESSAY" ? 2 : 1,
    }
    if (newType === "MCQ") {
      payload.options = newOptions.map((o) => o.trim()).filter(Boolean)
      payload.correctAnswer = newCorrect.trim()
    }
    if (newType === "COMPLETION") {
      payload.acceptedAnswers = newAccepted
        .split("|")
        .map((a) => a.trim())
        .filter(Boolean)
    }
    const { error: addErr } = await apiFetch(`/tests/${fullSet.id}/questions`, {
      method: "POST",
      json: payload,
    })
    setAddingBusy(false)
    if (addErr) {
      setAddError(addErr.message)
      return
    }
    setNotice("Question added.")
    setNewPrompt("")
    setNewPassage("")
    setNewCorrect("")
    setNewAccepted("")
    await loadSet(fullSet.id)
    void fetchSets()
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Question Bank</h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-generated and hand-authored test content. Students never see the answer keys.
            </p>
          </div>
          <span className="inline-flex items-center rounded-none border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground self-start">
            {sets ? `${sets.length} sets · ${sets.reduce((s, t) => s + t.questionCount, 0)} questions` : "—"}
          </span>
        </div>

        {notice && (
          <div role="status" className="rounded-lg border border-success/30 bg-success/10 text-xs px-3 py-2.5 text-emerald-900">
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {/* AI generation */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Generate a new question set with AI</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto] gap-3">
            <select
              aria-label="Skill"
              value={genSkill}
              onChange={(e) => setGenSkill(e.target.value as (typeof SKILLS)[number])}
              className="h-10 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
            >
              {SKILLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Input
              aria-label="Topic (optional)"
              placeholder="Topic (optional) — e.g. renewable energy, work-life balance"
              value={genTopic}
              onChange={(e) => setGenTopic(e.target.value)}
              className="h-10"
            />
            <Input
              aria-label="Number of questions"
              type="number"
              min={3}
              max={20}
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
              className="h-10 w-24"
            />
            <Button onClick={() => void generateNewSet()} disabled={generating} className="cursor-pointer h-10">
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </div>
        </div>

        {loading && !sets && (
          <div className="space-y-2" role="status" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
          </div>
        )}

        {!loading && sets && sets.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <h2 className="text-base font-semibold">No test sets yet</h2>
            <p className="text-sm text-muted-foreground mt-1">Generate your first AI set above.</p>
          </div>
        )}

        {sets && sets.length > 0 && (
          <div className="space-y-2">
            {sets.map((set) => (
              <div key={set.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => void openSet(set.id)}
                    className="flex items-center gap-3 text-left min-w-0 flex-1 cursor-pointer"
                    aria-expanded={expandedId === set.id}
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expandedId === set.id ? "" : "-rotate-90"}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{set.title}</span>
                        <span className={`rounded-none border px-2 py-0.5 text-[10px] font-medium ${SKILL_BADGE[set.skill]}`}>
                          {set.skill}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {set.questionCount} questions · {set.attemptsCount} attempts · {set.timeLimitMinutes} min
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {set.skill !== "FULL_MOCK" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void topUpSet(set)}
                        disabled={topUpBusy === set.id}
                        className="cursor-pointer gap-1.5"
                      >
                        {topUpBusy === set.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        )}
                        AI +5
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteSetTarget(set)}
                      disabled={set.attemptsCount > 0}
                      title={set.attemptsCount > 0 ? "Sets with attempt history cannot be deleted" : "Delete set"}
                      className="cursor-pointer gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>

                {expandedId === set.id && (
                  <div className="border-t border-border bg-surface-subtle p-4 space-y-3">
                    {fullLoading && (
                      <div className="h-20 rounded-lg bg-border/40 animate-pulse" aria-hidden />
                    )}
                    {fullSet && (
                      <>
                        {fullSet.questions.map((q) => (
                          <div key={q.id} className="rounded-lg border border-border bg-card p-3.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {q.questionType} · part {q.partNumber}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDeleteQuestionTarget(q)}
                                disabled={fullSet.attemptsCount > 0}
                                className="text-muted-foreground hover:text-destructive cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label={`Delete question ${q.orderIndex + 1}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                            <p className="text-xs leading-relaxed whitespace-pre-line">{q.prompt}</p>
                            {q.options && (
                              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                                {q.options.map((opt, i) => (
                                  <li key={i} className={opt === q.correctAnswer ? "text-success font-medium" : ""}>
                                    {opt === q.correctAnswer ? "✓ " : "· "}
                                    {opt}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {q.acceptedAnswers && (
                              <p className="text-[11px] text-success">
                                Accepted: {q.acceptedAnswers.join(" | ")}
                              </p>
                            )}
                          </div>
                        ))}

                        {showAddForm ? (
                          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <select
                                aria-label="Question type"
                                value={newType}
                                onChange={(e) => setNewType(e.target.value as typeof newType)}
                                className="h-10 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                              >
                                <option value="MCQ">MCQ</option>
                                <option value="COMPLETION">Completion</option>
                                <option value="ESSAY">Essay</option>
                                <option value="SPEAKING_PROMPT">Speaking prompt</option>
                              </select>
                            </div>
                            <Textarea
                              aria-label="Prompt"
                              placeholder="Question prompt…"
                              value={newPrompt}
                              onChange={(e) => setNewPrompt(e.target.value)}
                              className="min-h-[64px] text-sm"
                            />
                            <Textarea
                              aria-label="Passage / stimulus (optional)"
                              placeholder="Passage / transcript / data summary (optional, attached as source material)…"
                              value={newPassage}
                              onChange={(e) => setNewPassage(e.target.value)}
                              className="min-h-[64px] text-sm"
                            />
                            {newType === "MCQ" && (
                              <div className="space-y-2">
                                {newOptions.map((opt, i) => (
                                  <Input
                                    key={i}
                                    aria-label={`Option ${i + 1}`}
                                    placeholder={`Option ${i + 1}`}
                                    value={opt}
                                    onChange={(e) =>
                                      setNewOptions((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                                    }
                                    className="h-9 text-sm"
                                  />
                                ))}
                                <Input
                                  aria-label="Correct answer"
                                  placeholder="Correct answer (must match one option exactly)"
                                  value={newCorrect}
                                  onChange={(e) => setNewCorrect(e.target.value)}
                                  className="h-9 text-sm"
                                />
                              </div>
                            )}
                            {newType === "COMPLETION" && (
                              <Input
                                aria-label="Accepted answers"
                                placeholder="Accepted answers, separated by | (use ______ in the prompt as the blank)"
                                value={newAccepted}
                                onChange={(e) => setNewAccepted(e.target.value)}
                                className="h-9 text-sm"
                              />
                            )}
                            {addError && (
                              <p role="alert" className="text-xs text-destructive">{addError}</p>
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void addQuestionManually()} disabled={addingBusy || newPrompt.trim().length < 5} className="cursor-pointer">
                                {addingBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add question
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="cursor-pointer">
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)} className="cursor-pointer">
                            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add question manually
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={deleteSetTarget != null}
        title="Delete this test set?"
        description="The set and all of its questions will be removed. This is only possible while no student has attempted it."
        intent="destructive"
        confirmLabel="Delete set"
        cancelLabel="Keep it"
        isSubmitting={deletingSet}
        error={deleteError}
        onConfirm={() => void deleteSet()}
        onCancel={() => {
          setDeleteError(null)
          setDeleteSetTarget(null)
        }}
        details={deleteSetTarget ? `${deleteSetTarget.title} · ${deleteSetTarget.questionCount} questions` : undefined}
      />
      <ConfirmationModal
        isOpen={deleteQuestionTarget != null}
        title="Remove this question?"
        description="The question will be removed from the set before any student attempts it."
        intent="destructive"
        confirmLabel="Remove question"
        cancelLabel="Keep it"
        isSubmitting={deletingQuestion}
        error={deleteError}
        onConfirm={() => void deleteQuestion()}
        onCancel={() => {
          setDeleteError(null)
          setDeleteQuestionTarget(null)
        }}
        details={deleteQuestionTarget?.prompt.slice(0, 120)}
      />
    </div>
  )
}
