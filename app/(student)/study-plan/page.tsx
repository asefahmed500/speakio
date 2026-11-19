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
  Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
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
      title: "Speed reading & argument mapping",
      skill: "READING",
      durationMinutes: 45,
      isCompleted: false,
      taskDetails: "Complete a timed academic passage and analyse sentence-level text organization.",
    },
    {
      id: `plan-${now}-4`,
      day: 4,
      title: "Examiner cue-card speaking run",
      skill: "SPEAKING",
      durationMinutes: 30,
      isCompleted: false,
      taskDetails: "Record a full Part 2 long turn and Part 3 analytical discussion with the AI Examiner.",
    },
    {
      id: `plan-${now}-5`,
      day: 5,
      title: "Writing Task 2 full timed essay",
      skill: "WRITING",
      durationMinutes: 40,
      isCompleted: false,
      taskDetails: "Produce a 250+ word academic essay under official time constraints for dual-pass scoring.",
    },
  ]
}

export default function StudyPlanPage() {
  const user = useSessionUser()
  const [plan, setPlan] = useState<StudyPlanMilestone[]>(user.studyPlanJson ?? [])
  const [examDate, setExamDate] = useState<string>(
    user.examDate ? user.examDate.slice(0, 10) : ""
  )
  const [dailyMinutes, setDailyMinutes] = useState<string>(
    String(user.dailyCommitmentMinutes ?? 45)
  )
  const [weakestSkill, setWeakestSkill] = useState<string>(user.weakestSkill ?? "WRITING")

  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const completed = plan.filter((m) => m.isCompleted).length
  const progressPct = plan.length > 0 ? Math.round((completed / plan.length) * 100) : 0

  const [nowTime, setNowTime] = useState<number | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setNowTime(Date.now())
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const daysToExam = useMemo(() => {
    if (!examDate || !nowTime) return null
    const target = new Date(examDate).getTime()
    const diff = Math.ceil((target - nowTime) / (1000 * 60 * 60 * 24))
    return Number.isFinite(diff) ? diff : null
  }, [examDate, nowTime])

  const persist = async (patch: {
    studyPlan?: StudyPlanMilestone[]
    examDate?: string | null
    dailyCommitmentMinutes?: number
    weakestSkill?: string
  }): Promise<boolean> => {
    setSaving(true)
    setSaveError(null)
    const { error } = await apiFetch("/users/me", {
      method: "PATCH",
      json: patch,
    })
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return false
    }
    setSaveSuccess(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 2500)
    return true
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
    setPlanError(null)
    const { data, error } = await apiFetch<{ milestones: StudyPlanMilestone[] }>("/ai/study-plan", {
      method: "POST",
      json: {},
      timeoutMs: 0,
    })
    const next =
      data?.milestones && data.milestones.length > 0
        ? data.milestones
        : generatePlan(user.targetBand ?? 7.0, weakestSkill as StudyPlanMilestone["skill"])
    if (error && !data) {
      setPlanError(`AI coach unavailable — using standard template. (${error.message})`)
    }
    const ok = await persist({ studyPlan: next })
    if (ok) setPlan(next)
    setGenerating(false)
  }

  const handleToggle = async (id: string) => {
    if (saving) return
    const next = plan.map((m) => (m.id === id ? { ...m, isCompleted: !m.isCompleted } : m))
    setPlan(next)
    const ok = await persist({ studyPlan: next })
    if (!ok) setPlan(plan)
  }

  return (
    <div className="relative min-h-0 bg-background text-foreground">
      {/* Ambient Lighting Orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-indigo-500/10 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Header Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#16213A]/80 via-[#10192B]/90 to-[#0B0E14] p-6 sm:p-8 backdrop-blur-2xl shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-[11px] font-mono tracking-widest text-cyan-300 uppercase">
              <Sparkles className="size-3.5 text-cyan-400" />
              <span>AI Study Planner</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Personalized IELTS Study Plan
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-xl leading-relaxed">
              Tailored specifically to your Target Band {(user.targetBand ?? 7.0).toFixed(1)}, exam deadline, and priority skill focus.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating || saving}
              className="cursor-pointer rounded-xl bg-white px-5 py-2.5 text-xs font-medium text-black hover:bg-neutral-200 transition-all shadow-md shrink-0"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-3.5 text-cyan-600" />
                  {plan.length === 0 ? "Generate AI Plan" : "Regenerate Plan"}
                </>
              )}
            </Button>
          </div>
        </div>

        {planError && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{planError}</span>
          </div>
        )}

        {saveError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200 flex items-start gap-2.5">
            <AlertCircle className="size-4 shrink-0 mt-0.5 text-red-400" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Preferences Form */}
        <div className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-foreground">Candidate Plan Parameters</h2>
            <span className="text-xs font-mono text-cyan-300">CUSTOM SCHEDULE</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="sp-exam-date" className="text-xs font-medium text-muted-foreground">
                Target Exam Date
              </label>
              <Input
                id="sp-exam-date"
                type="date"
                value={examDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExamDate(e.target.value)}
                className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
              />
              {daysToExam != null && daysToExam >= 0 && (
                <p className="text-[11px] text-cyan-300 flex items-center gap-1 font-mono">
                  <CalendarDays className="size-3" />
                  {daysToExam} {daysToExam === 1 ? "day" : "days"} remaining
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sp-daily" className="text-xs font-medium text-muted-foreground">
                Daily Study Time (minutes)
              </label>
              <Input
                id="sp-daily"
                type="number"
                min={10}
                max={600}
                value={dailyMinutes}
                onChange={(e) => setDailyMinutes(e.target.value)}
                className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sp-weakest" className="text-xs font-medium text-muted-foreground">
                Priority Skill Focus
              </label>
              <select
                id="sp-weakest"
                value={weakestSkill}
                onChange={(e) => setWeakestSkill(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-xs text-foreground outline-none focus:border-cyan-400"
              >
                <option value="LISTENING" className="bg-[#121927] text-foreground">Listening</option>
                <option value="READING" className="bg-[#121927] text-foreground">Reading</option>
                <option value="WRITING" className="bg-[#121927] text-foreground">Writing</option>
                <option value="SPEAKING" className="bg-[#121927] text-foreground">Speaking</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              size="sm"
              onClick={() => void handleSavePreferences()}
              disabled={saving}
              className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200"
            >
              {saving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
              Save Parameters
            </Button>
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-mono">
                <CheckCircle2 className="size-3.5" /> Saved to account
              </span>
            )}
          </div>
        </div>

        {/* Plan Milestones Progress */}
        {plan.length > 0 && (
          <div className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Milestone Completion</h2>
                <p className="text-xs text-muted-foreground">Track your daily IELTS practice tasks</p>
              </div>
              <span className="text-xs font-mono text-cyan-300">
                {completed}/{plan.length} DONE ({progressPct}%)
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-card">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="space-y-3 pt-3">
              {plan.map((milestone) => {
                const Icon = SKILL_ICON[milestone.skill] ?? Compass
                return (
                  <div
                    key={milestone.id}
                    className={`rounded-2xl border p-4 sm:p-5 flex items-start gap-4 transition-all ${
                      milestone.isCompleted
                        ? "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
                        : "border-border bg-surface-subtle hover:bg-surface-subtle"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggle(milestone.id)}
                      disabled={saving}
                      aria-pressed={milestone.isCompleted}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-cyan-400 cursor-pointer"
                    >
                      {milestone.isCompleted ? (
                        <CheckCircle2 className="size-5 text-emerald-400" />
                      ) : (
                        <Circle className="size-5" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-medium ${milestone.isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {milestone.title}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-[10px] font-mono text-cyan-300">
                          <Icon className="size-3" />
                          {SKILL_LABEL[milestone.skill] ?? milestone.skill}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">Day {milestone.day}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{milestone.durationMinutes} min</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{milestone.taskDetails}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {plan.length === 0 && (
          <div className="rounded-3xl border border-border bg-surface-subtle p-10 text-center space-y-4 backdrop-blur-xl">
            <Target className="size-10 text-cyan-400 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">No Active Plan Configured</h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Generate a custom plan targeting your target band with our AI study coach.
              </p>
            </div>
            <Button
              onClick={() => void handleGenerate()}
              className="rounded-xl bg-white px-5 py-2.5 text-xs font-medium text-black hover:bg-neutral-200"
            >
              Generate AI Plan
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
