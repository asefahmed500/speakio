"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Headphones,
  BookOpen,
  FileText,
  Mic,
  Compass,
  Loader2,
  Sparkles,
  CalendarDays,
} from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSessionUser } from "@/components/user-session-provider"
import { apiFetch } from "@/lib/api-client"
import type { StudyPlanMilestone } from "@/lib/session"

const SKILL_ICON: Record<StudyPlanMilestone["skill"], React.ElementType> = {
  LISTENING: Headphones,
  READING: BookOpen,
  WRITING: FileText,
  SPEAKING: Mic,
  MOCK: Compass,
}

const SKILL_LABEL: Record<StudyPlanMilestone["skill"], string> = {
  LISTENING: "Listening",
  READING: "Reading",
  WRITING: "Writing",
  SPEAKING: "Speaking",
  MOCK: "Full mock",
}

function generatePlan(targetBand: number, weakestSkill: StudyPlanMilestone["skill"]): StudyPlanMilestone[] {
  const now = Date.now()
  return [
    {
      id: `plan-${now}-1`,
      day: 1,
      title: `${SKILL_LABEL[weakestSkill]} diagnostic drill`,
      skill: weakestSkill,
      durationMinutes: 45,
      isCompleted: false,
      taskDetails: `Focused practice targeting Band ${targetBand.toFixed(1)} descriptors in ${SKILL_LABEL[
        weakestSkill
      ].toLowerCase()}.`,
    },
    {
      id: `plan-${now}-2`,
      day: 2,
      title: "Academic vocabulary & collocations",
      skill: "WRITING",
      durationMinutes: 30,
      isCompleted: false,
      taskDetails: "Build Band 8.0+ topic vocabulary and precise discourse markers in the Vocabulary Studio.",
    },
    {
      id: `plan-${now}-3`,
      day: 3,
      title: "Speaking long-turn practice",
      skill: "SPEAKING",
      durationMinutes: 35,
      isCompleted: false,
      taskDetails: "Record a Part 2 cue-card response and submit it for examiner review.",
    },
    {
      id: `plan-${now}-4`,
      day: 4,
      title: "Timed reading & listening run",
      skill: "READING",
      durationMinutes: 50,
      isCompleted: false,
      taskDetails: "Complete one reading passage and one listening section under exam timing.",
    },
    {
      id: `plan-${now}-5`,
      day: 5,
      title: `Milestone mock for Band ${targetBand.toFixed(1)}`,
      skill: "MOCK",
      durationMinutes: 60,
      isCompleted: false,
      taskDetails: "Finish one full test per skill this week to qualify for a verified certificate.",
    },
  ]
}

export default function StudyPlanPage() {
  const user = useSessionUser()
  const [plan, setPlan] = useState<StudyPlanMilestone[]>(user.studyPlanJson ?? [])
  const [examDate, setExamDate] = useState(user.examDate ? user.examDate.slice(0, 10) : "")
  const [dailyMinutes, setDailyMinutes] = useState(String(user.dailyCommitmentMinutes ?? 45))
  const [weakestSkill, setWeakestSkill] = useState<string>(user.weakestSkill ?? "WRITING")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [generating, setGenerating] = useState(false)
  const saveSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveSuccessTimer.current) clearTimeout(saveSuccessTimer.current)
    }
  }, [])

  const completed = useMemo(() => plan.filter((m) => m.isCompleted).length, [plan])
  const progressPct = plan.length > 0 ? Math.round((completed / plan.length) * 100) : 0
  const daysToExam = useMemo(() => {
    if (!examDate) return null
    // Reading the clock once per examDate change is intentional here.
    // eslint-disable-next-line react-hooks/purity -- needs the current time at render
    const diff = Math.ceil((new Date(examDate).getTime() - Date.now()) / 86_400_000)
    return Number.isFinite(diff) ? diff : null
  }, [examDate])

  const persist = async (next: {
    studyPlan?: StudyPlanMilestone[]
    examDate?: string | null
    dailyCommitmentMinutes?: number
    weakestSkill?: string
  }) => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const { error } = await apiFetch("/users/me", {
        method: "PATCH",
        json: {
          ...next,
          examDate: next.examDate !== undefined ? (next.examDate ? new Date(next.examDate).toISOString() : null) : undefined,
        },
      })
      if (error) {
        setSaveError(error.message)
        return false
      }
      setSaveSuccess(true)
      if (saveSuccessTimer.current) clearTimeout(saveSuccessTimer.current)
      saveSuccessTimer.current = setTimeout(() => setSaveSuccess(false), 2500)
      return true
    } finally {
      setSaving(false)
    }
  }

  const handleSavePreferences = async () => {
    const minutes = Number(dailyMinutes)
    if (!Number.isFinite(minutes) || minutes < 10 || minutes > 600) {
      setSaveError("Daily commitment must be between 10 and 600 minutes.")
      return
    }
    await persist({
      examDate: examDate || null,
      dailyCommitmentMinutes: minutes,
      weakestSkill,
    })
  }

  const handleGenerate = async () => {
    setGenerating(true)
    const next = generatePlan(user.targetBand ?? 7.0, weakestSkill as StudyPlanMilestone["skill"])
    const ok = await persist({ studyPlan: next })
    if (ok) setPlan(next)
    setGenerating(false)
  }

  const handleToggle = async (id: string) => {
    // Toggling is disabled while a save is in flight (see the button below),
    // so `next` is always computed from settled state and the closure rollback
    // can never revert a newer, unrelated toggle.
    if (saving) return
    const next = plan.map((m) => (m.id === id ? { ...m, isCompleted: !m.isCompleted } : m))
    setPlan(next) // optimistic
    const ok = await persist({ studyPlan: next })
    if (!ok) setPlan(plan) // rollback on failure
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Study Planner</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your plan and progress are saved to your account automatically.
            </p>
          </div>
          {plan.length === 0 ? (
            <Button onClick={() => void handleGenerate()} disabled={generating || saving} className="cursor-pointer self-start sm:self-auto">
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Generate my plan
                </>
              )}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void handleGenerate()} disabled={generating || saving} className="cursor-pointer self-start sm:self-auto">
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Regenerating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Regenerate plan
                </>
              )}
            </Button>
          )}
        </div>

        {saveError && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            {saveError}
          </div>
        )}

        {/* Preferences */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Preferences</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="sp-exam-date" className="text-xs font-medium">Exam date</label>
              <Input
                id="sp-exam-date"
                type="date"
                value={examDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExamDate(e.target.value)}
                className="h-10"
              />
              {daysToExam != null && daysToExam >= 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" aria-hidden />
                  {daysToExam} {daysToExam === 1 ? "day" : "days"} remaining
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sp-daily" className="text-xs font-medium">Daily commitment (min)</label>
              <Input
                id="sp-daily"
                type="number"
                min={10}
                max={600}
                value={dailyMinutes}
                onChange={(e) => setDailyMinutes(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sp-weakest" className="text-xs font-medium">Focus skill</label>
              <select
                id="sp-weakest"
                value={weakestSkill}
                onChange={(e) => setWeakestSkill(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="LISTENING">Listening</option>
                <option value="READING">Reading</option>
                <option value="WRITING">Writing</option>
                <option value="SPEAKING">Speaking</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => void handleSavePreferences()} disabled={saving} className="cursor-pointer">
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save preferences
            </Button>
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        {plan.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Progress</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {completed}/{plan.length} milestones · {progressPct}%
              </span>
            </div>
            <div className="h-2 rounded-none bg-border overflow-hidden" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-none bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Milestones */}
        {plan.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <h2 className="text-base font-semibold">No study plan yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate a personalized five-day plan focused on your weakest skill, or start
              practising right away.
            </p>
            <ButtonLink className="cursor-pointer" href="/skills/listening">
              Browse practice tests
            </ButtonLink>
          </div>
        ) : (
          <ul className="space-y-2">
            {plan.map((milestone) => {
              const Icon = SKILL_ICON[milestone.skill] ?? Compass
              return (
                <li
                  key={milestone.id}
                  className={`rounded-xl border bg-card p-4 flex items-start gap-3 transition-colors ${
                    milestone.isCompleted ? "border-success/30 bg-success/5" : "border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggle(milestone.id)}
                    disabled={saving}
                    aria-pressed={milestone.isCompleted}
                    aria-label={
                      milestone.isCompleted
                        ? `Mark milestone as not done: ${milestone.title}`
                        : `Mark milestone as complete: ${milestone.title}`
                    }
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-60"
                  >
                    {milestone.isCompleted ? (
                      <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                    ) : (
                      <Circle className="h-5 w-5" aria-hidden />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{milestone.title}</span>
                      <span className="inline-flex items-center gap-1 rounded-none border border-border bg-surface-subtle px-2 py-0.5 text-[10px] text-muted-foreground">
                        <Icon className="h-2.5 w-2.5" aria-hidden />
                        {SKILL_LABEL[milestone.skill] ?? milestone.skill}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Day {milestone.day}</span>
                      <span className="text-[10px] text-muted-foreground">{milestone.durationMinutes} min</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{milestone.taskDetails}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
