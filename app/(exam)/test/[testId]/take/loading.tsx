import { Loader2 } from "lucide-react"

/** Route-level fallback so tapping "Start Test" never looks like a dead click. */
export default function ExamTakeLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground p-4">
      <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-medium">Preparing IELTS Exam Room…</h2>
        <p className="text-xs text-muted-foreground">
          Loading your test and verifying your session.
        </p>
      </div>
    </div>
  )
}
