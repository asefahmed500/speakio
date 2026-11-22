"use client"

import React, { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  BookMarked,
  Check,
  Copy,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { apiFetch } from "@/lib/api-client"
import { customVocabSchema } from "@/lib/validations/vocabulary"

interface VocabItem {
  id: string
  word: string
  phonetic: string | null
  partOfSpeech: string
  definition: string
  bandTarget: number
  topic: string
  collocations: string[]
  synonyms: string[]
  exampleSentence: string
}

const TOPICS = ["ALL", "Environment", "Technology", "Education", "Society", "Economy", "Health"] as const

const EMPTY_FORM = {
  word: "",
  phonetic: "",
  partOfSpeech: "noun",
  definition: "",
  bandTarget: "7.0",
  topic: "Environment",
  collocations: "",
  synonyms: "",
  exampleSentence: "",
}

export default function VocabularyPage() {
  const [items, setItems] = useState<VocabItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState("")
  const [topic, setTopic] = useState<string>("ALL")

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<VocabItem | null>(null)

  const [sourceText, setSourceText] = useState("")
  const [rewrites, setRewrites] = useState<string[]>([])
  const [paraphrasing, setParaphrasing] = useState(false)
  const [paraphraseError, setParaphraseError] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const fetchVocabulary = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<VocabItem[]>("/vocabulary")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load vocabulary.")
      setItems(null)
    } else {
      setItems(data)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchVocabulary()
    })
    return () => {
      active = false
    }
  }, [fetchVocabulary])

  const retryFetch = () => {
    setLoading(true)
    void fetchVocabulary()
  }

  const filtered = (items ?? []).filter((item) => {
    const matchesTopic = topic === "ALL" || item.topic.toLowerCase() === topic.toLowerCase()
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || item.word.toLowerCase().includes(q) || item.definition.toLowerCase().includes(q)
    return matchesTopic && matchesQuery
  })

  const handleAdd = async () => {
    setFormError(null)
    const collocations = form.collocations.split(",").map((s) => s.trim()).filter(Boolean)
    const synonyms = form.synonyms.split(",").map((s) => s.trim()).filter(Boolean)
    const payload = {
      word: form.word,
      phonetic: form.phonetic || null,
      partOfSpeech: form.partOfSpeech,
      definition: form.definition,
      bandTarget: Number(form.bandTarget),
      topic: form.topic,
      collocations,
      synonyms,
      exampleSentence: form.exampleSentence,
    }
    const parsed = customVocabSchema.safeParse(payload)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check the form and try again.")
      return
    }
    setSaving(true)
    const { data, error: saveError } = await apiFetch<VocabItem>("/vocabulary", {
      method: "POST",
      json: payload,
    })
    setSaving(false)
    if (saveError || !data) {
      setFormError(saveError?.message ?? "Could not save the word.")
      return
    }
    setItems((prev) => [data, ...(prev ?? [])])
    setForm(EMPTY_FORM)
    setAddOpen(false)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const { error: delError } = await apiFetch(`/vocabulary/${id}`, { method: "DELETE" })
    if (delError) {
      setError(delError.message)
    } else {
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id))
    }
    setDeletingId(null)
    setPendingDelete(null)
  }

  const handleParaphrase = async () => {
    setParaphraseError(null)
    setRewrites([])
    setParaphrasing(true)
    const { data, error: aiError } = await apiFetch<{ rewrites: string[] }>("/ai/paraphrase", {
      method: "POST",
      json: { text: sourceText },
    })
    setParaphrasing(false)
    if (aiError || !data) {
      setParaphraseError(aiError?.message ?? "Could not rewrite the text.")
      return
    }
    setRewrites(data.rewrites)
  }

  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  const handleCopyRewrite = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedIdx(null), 1500)
    } catch {
      window.prompt("Copy:", text)
    }
  }

  // Modal semantics: Escape closes, background scroll is locked, and the
  // first field receives focus — matching the ConfirmationModal contract.
  const firstFieldRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    if (!addOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddOpen(false)
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)
    firstFieldRef.current?.focus()
    return () => {
      document.body.style.overflow = "unset"
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [addOpen])

  return (
    <div className="flex-1 bg-background text-foreground min-h-0 relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-muted blur-[130px]" />
      <div className="pointer-events-none absolute top-1/2 -right-20 h-96 w-96 rounded-full bg-primary/5 blur-[140px]" />
      <div className="w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Vocabulary</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {items != null
                ? `${items.length} saved ${items.length === 1 ? "word" : "words"}`
                : "Your band 7+ word bank"}
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="cursor-pointer self-start sm:self-auto">
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Add word
          </Button>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
            </span>
            <Button variant="outline" size="sm" onClick={retryFetch}>
              Retry
            </Button>
          </div>
        )}

        {/* Search + topic filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search words…"
              aria-label="Search vocabulary"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by topic">
            {TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                aria-pressed={topic === t}
                className={`shrink-0 rounded-none border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  topic === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "ALL" ? "All" : t}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="status" aria-live="polite">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
            <span className="sr-only">Loading vocabulary…</span>
          </div>
        )}

        {!loading && items != null && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center">
              <BookMarked className="h-5 w-5 text-primary" aria-hidden />
            </div>
            {items.length === 0 ? (
              <>
                <h2 className="text-base font-semibold">No words saved yet</h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Save Band 7+ words and collocations to review before your exam.
                </p>
                <Button onClick={() => setAddOpen(true)} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" aria-hidden /> Add your first word
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold">No matches</h2>
                <p className="text-sm text-muted-foreground">
                  Try a different search or clear the topic filter.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setTopic("ALL")
                  }}
                >
                  Clear filters
                </Button>
              </>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="text-sm font-semibold">{item.word}</h2>
                      {item.phonetic && (
                        <span className="text-[11px] text-muted-foreground">{item.phonetic}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {item.partOfSpeech} · {item.topic} · Band {item.bandTarget.toFixed(1)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(item)}
                    disabled={deletingId === item.id}
                    aria-label={`Delete ${item.word}`}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed">{item.definition}</p>
                {item.exampleSentence && (
                  <p className="text-xs text-muted-foreground italic leading-relaxed">{item.exampleSentence}</p>
                )}
                {(item.collocations.length > 0 || item.synonyms.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {item.collocations.map((c) => (
                      <span key={c} className="rounded-none bg-primary/10 border border-primary/20 text-primary px-2 py-0.5 text-[10px]">
                        {c}
                      </span>
                    ))}
                    {item.synonyms.map((s) => (
                      <span key={s} className="rounded-none bg-surface-subtle border border-border text-muted-foreground px-2 py-0.5 text-[10px]">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Academic rewriter */}
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Academic rewriter</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">AI</span>
          </div>
          <Textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Paste a sentence to rewrite at Band 8+ level…"
            className="min-h-[72px] text-sm"
            aria-label="Sentence to rewrite"
            maxLength={2000}
          />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => void handleParaphrase()}
              disabled={paraphrasing || sourceText.trim().length < 10 || sourceText.length > 2000}
              className="cursor-pointer"
            >
              {paraphrasing ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Rewriting…
                </>
              ) : (
                "Rewrite"
              )}
            </Button>
            {sourceText.trim().length > 0 && sourceText.trim().length < 10 && (
              <span className="text-[11px] text-muted-foreground">Minimum 10 characters</span>
            )}
            {sourceText.length >= 1900 && (
              <span className="text-[11px] text-muted-foreground">
                {sourceText.length}/2000 characters
              </span>
            )}
          </div>
          {paraphraseError && (
            <p role="alert" className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {paraphraseError}
            </p>
          )}
          {rewrites.length > 0 && (
            <ul className="space-y-2 pt-1">
              {rewrites.map((rewrite, idx) => (
                <li
                  key={idx}
                  className="group flex items-start justify-between gap-3 rounded-lg bg-surface-subtle border border-border px-3 py-2.5"
                >
                  <p className="text-xs leading-relaxed">{rewrite}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCopyRewrite(idx, rewrite)}
                    aria-label={`Copy rewrite ${idx + 1}`}
                    className="h-6 w-6 p-0 shrink-0 cursor-pointer"
                  >
                    {copiedIdx === idx ? (
                      <Check className="h-3 w-3 text-success" aria-hidden />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Add-word modal */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-word-title"
        >
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-black/30"
            onClick={() => setAddOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="add-word-title" className="text-base font-semibold">Add word</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {formError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="vw-word" className="text-xs font-medium">Word *</label>
                <Input
                  id="vw-word"
                  ref={firstFieldRef}
                  value={form.word}
                  onChange={(e) => setForm({ ...form, word: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vw-phon" className="text-xs font-medium">Phonetic</label>
                <Input
                  id="vw-phon"
                  value={form.phonetic}
                  onChange={(e) => setForm({ ...form, phonetic: e.target.value })}
                  placeholder="/wɜːd/"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vw-pos" className="text-xs font-medium">Part of speech</label>
                <select
                  id="vw-pos"
                  value={form.partOfSpeech}
                  onChange={(e) => setForm({ ...form, partOfSpeech: e.target.value })}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {["noun", "verb", "adjective", "adverb", "collocation", "idiom"].map((p) => (
                    <option key={p} value={p} className="bg-card text-foreground">{p}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vw-topic" className="text-xs font-medium">Topic</label>
                <select
                  id="vw-topic"
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {TOPICS.filter((t) => t !== "ALL").map((t) => (
                    <option key={t} value={t} className="bg-card text-foreground">{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vw-band" className="text-xs font-medium">Band target</label>
                <select
                  id="vw-band"
                  value={form.bandTarget}
                  onChange={(e) => setForm({ ...form, bandTarget: e.target.value })}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {[6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0].map((b) => (
                    <option key={b} value={b} className="bg-card text-foreground">{b.toFixed(1)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vw-syn" className="text-xs font-medium">Synonyms (comma separated)</label>
                <Input
                  id="vw-syn"
                  value={form.synonyms}
                  onChange={(e) => setForm({ ...form, synonyms: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vw-def" className="text-xs font-medium">Definition *</label>
              <Textarea
                id="vw-def"
                value={form.definition}
                onChange={(e) => setForm({ ...form, definition: e.target.value })}
                className="min-h-[60px] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vw-colloc" className="text-xs font-medium">Collocations (comma separated)</label>
              <Input
                id="vw-colloc"
                value={form.collocations}
                onChange={(e) => setForm({ ...form, collocations: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vw-example" className="text-xs font-medium">Example sentence *</label>
              <Textarea
                id="vw-example"
                value={form.exampleSentence}
                onChange={(e) => setForm({ ...form, exampleSentence: e.target.value })}
                className="min-h-[60px] text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddOpen(false)} className="cursor-pointer">
                Cancel
              </Button>
              <Button
                onClick={() => void handleAdd()}
                disabled={saving || !form.word.trim() || !form.definition.trim() || !form.exampleSentence.trim()}
                className="cursor-pointer"
              >
                {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                Save word
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        title="Delete this word?"
        description="This saved word and its details will be permanently removed from your vocabulary studio."
        intent="destructive"
        confirmLabel={deletingId ? "Deleting…" : "Delete word"}
        cancelLabel="Keep it"
        isSubmitting={deletingId !== null}
        details={
          pendingDelete ? (
            <p className="text-sm font-medium">
              {pendingDelete.word}
              {pendingDelete.phonetic ? ` ${pendingDelete.phonetic}` : ""}
            </p>
          ) : null
        }
        onConfirm={() => (pendingDelete ? handleDelete(pendingDelete.id) : Promise.resolve())}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

