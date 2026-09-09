"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BookOpen,
  Headphones,
  FileText,
  Mic,
  Award,
  BarChart3,
  Cpu,
  LogOut,
  Menu,
  PanelRight,
  Compass,
  CheckCircle2,
  Calendar,
  BookMarked,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { UserSessionProvider, useSessionUser } from "@/components/user-session-provider"
import { SpeakioMark } from "@/components/logo"
import { apiFetch } from "@/lib/api-client"
import { useExamStore } from "@/stores/use-exam-store"
import { isStaff, type SessionUser } from "@/lib/user"

const studentNavItems = [
  { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
  { name: "Study Planner", href: "/study-plan", icon: Calendar },
  { name: "Vocabulary Studio", href: "/vocabulary", icon: BookMarked },
  { name: "Listening", href: "/skills/listening", icon: Headphones },
  { name: "Reading", href: "/skills/reading", icon: BookOpen },
  { name: "Writing AI", href: "/skills/writing", icon: FileText, badge: "AI Graded" },
  { name: "Speaking", href: "/skills/speaking", icon: Mic },
  { name: "Certificates", href: "/certificates", icon: Award },
]

function StudentShellContent({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useSessionUser()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const staff = isStaff(user.role)
  const activeTest = { name: "Start a Practice Test", href: "/skills/listening", icon: Compass }

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true)
    try {
      await apiFetch("/auth/logout", { method: "POST" })
    } finally {
      // Never leave an exam draft (essay text, answers) on a shared machine.
      useExamStore.getState().clearExamDraft()
      setIsLoggingOut(false)
      setShowLogoutModal(false)
      router.push("/login")
    }
  }

  const renderNavItem = (item: { name: string; href: string; icon: React.ElementType; badge?: string }) => {
    const Icon = item.icon
    const isActive = pathname === item.href
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs transition-colors ${
          isActive
            ? "bg-card text-primary font-medium border border-border shadow-xs"
            : "text-foreground/80 hover:bg-card hover:text-foreground border border-transparent"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{item.name}</span>
        </span>
        {item.badge && (
          <span className="rounded-none bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary border border-primary/20">
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Mobile Top Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border z-40 flex items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="Speakio dashboard">
          <SpeakioMark className="size-7" />
          <span className="font-semibold text-sm tracking-tight">SPEAKIO</span>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls="student-sidebar"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          className="h-9 w-9 p-0"
        >
          {mobileOpen ? <PanelRight className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 top-14 z-20 bg-black/20"
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        id="student-sidebar"
        className={`fixed md:sticky top-0 left-0 z-30 h-screen w-64 shrink-0 border-r border-border bg-surface-subtle flex flex-col justify-between transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex flex-col flex-1 overflow-y-auto">
          {/* Brand Header */}
          <div className="h-16 border-b border-border px-4 flex items-center justify-between gap-2">
            <Link href="/dashboard" className="flex items-center gap-3" aria-label="Speakio dashboard">
              <SpeakioMark className="size-8" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-foreground">SPEAKIO</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  IELTS Academic
                </span>
              </div>
            </Link>
            {/* Panel-right toggle: the single open/close control for the drawer. */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              aria-controls="student-sidebar"
              aria-expanded={mobileOpen}
              className="md:hidden cursor-pointer"
            >
              <PanelRight />
            </Button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1" aria-label="Main navigation">
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Preparation
            </div>
            {studentNavItems.map(renderNavItem)}
            <div className="pt-3 px-3 pb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Practice
            </div>
            {renderNavItem(activeTest)}

            {staff && (
              <>
                <div className="pt-4 px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Administration
                </div>
                <Link
                  href="/agent-ops"
                  onClick={() => setMobileOpen(false)}
                  aria-current={pathname === "/agent-ops" ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs transition-colors ${
                    pathname === "/agent-ops"
                      ? "bg-card text-primary font-medium border border-border shadow-xs"
                      : "text-foreground/80 hover:bg-card border border-transparent"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                    <span>Agent Ops</span>
                  </span>
                </Link>
                <Link
                  href="/review-queue"
                  onClick={() => setMobileOpen(false)}
                  aria-current={pathname === "/review-queue" ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs transition-colors ${
                    pathname === "/review-queue"
                      ? "bg-card text-primary font-medium border border-border shadow-xs"
                      : "text-foreground/80 hover:bg-card border border-transparent"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <span>Review Queue</span>
                  </span>
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* User Card */}
        <div className="p-3 border-t border-border bg-card">
          <div className="rounded-lg p-3 bg-surface-subtle border border-border flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold truncate text-foreground">{user.name}</span>
                <span className="rounded-none px-1.5 py-0.5 text-[9px] uppercase bg-primary/10 text-primary border border-primary/20">
                  {user.role}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground truncate">
                Target: <span className="font-medium text-primary">Band {(user.targetBand ?? 7.0).toFixed(1)}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutModal(true)}
              aria-label="Sign out"
              className="shrink-0 cursor-pointer gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">{children}</main>

      {/* Logout Confirmation Modal */}
      <ConfirmationModal
        isOpen={showLogoutModal}
        title="Sign Out of Speakio?"
        description="Are you sure you want to sign out? Your session will be terminated and you will need to sign in again to access your practice modules."
        intent="warning"
        confirmLabel="Sign Out"
        cancelLabel="Stay Signed In"
        isSubmitting={isLoggingOut}
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutModal(false)}
        details={`User: ${user.name} (${user.email}) | Role: ${user.role}`}
      />
    </div>
  )
}

export function StudentShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <UserSessionProvider user={user}>
      <StudentShellContent>{children}</StudentShellContent>
    </UserSessionProvider>
  )
}
