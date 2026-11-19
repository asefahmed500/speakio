import React from "react"

/**
 * The single content container for pages inside AppShell. Keeps max width,
 * padding and vertical rhythm identical across features and breakpoints.
 * Page headers, filter tabs and tables all live inside this one container.
 */
export function PageContainer({
  children,
  width = "default",
  className = "",
}: {
  children: React.ReactNode
  width?: "narrow" | "default" | "wide"
  className?: string
}) {
  const maxWidth =
    width === "narrow"
      ? "max-w-3xl"
      : width === "wide"
        ? "max-w-6xl"
        : "max-w-5xl"
  return (
    <main className={`mx-auto w-full ${maxWidth} px-4 py-6 sm:px-6 sm:py-8 ${className}`}>
      {children}
    </main>
  )
}

/** Consistent page heading used above tabs and content. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Consistent filter/tab strip — stays inside PageContainer, never in the sidebar. */
export function TabStrip({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-5 flex flex-wrap gap-1.5 border-b border-border pb-2"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`cursor-pointer border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
            value === tab.value
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
