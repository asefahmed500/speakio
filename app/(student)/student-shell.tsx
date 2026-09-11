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
  PanelRight,
  Compass,
  CheckCircle2,
  Calendar,
  BookMarked,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { UserSessionProvider, useSessionUser } from "@/components/user-session-provider"
import { SpeakioMark } from "@/components/logo"
import { apiFetch } from "@/lib/api-client"
import { useExamStore } from "@/stores/use-exam-store"
import { isAdmin, isStaff, type SessionUser } from "@/lib/user"

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

const staffNavItems = [
  { name: "Agent Ops", href: "/agent-ops", icon: Cpu },
  { name: "Review Queue", href: "/review-queue", icon: CheckCircle2 },
]

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  badge?: string
}

/**
 * Single open/close control for the sidebar on every breakpoint.
 * Mobile: opens/closes the drawer Sheet. Desktop: collapses/expands the rail.
 * Uses the PanelRight glyph per the Speakio shell spec.
 */
function SidebarPanelToggle({ className }: { className?: string }) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : open
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggleSidebar}
      aria-expanded={expanded}
      aria-label={expanded ? "Close navigation sidebar" : "Open navigation sidebar"}
      className={`cursor-pointer text-muted-foreground hover:text-foreground ${className ?? ""}`}
    >
      <PanelRight />
    </Button>
  )
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup className="p-2">
      <SidebarGroupLabel className="rounded-none px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {items.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton
                  render={
                    <Link
                      href={item.href}
                      onClick={() => setOpenMobile(false)}
                      aria-current={isActive ? "page" : undefined}
                    />
                  }
                  isActive={isActive}
                  tooltip={item.name}
                  className="h-9 rounded-none border border-transparent px-3 text-xs data-active:border-border data-active:bg-card data-active:shadow-xs"
                >
                  <Icon className={isActive ? "text-primary" : "text-muted-foreground"} />
                  <span className={isActive ? "font-medium text-primary" : "text-foreground/80"}>
                    {item.name}
                  </span>
                </SidebarMenuButton>
                {item.badge && (
                  <SidebarMenuBadge className="rounded-none border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {item.badge}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function CollapsedRailReveal() {
  const { isMobile, open, setOpen } = useSidebar()
  if (isMobile || open) return null
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      aria-label="Open navigation sidebar"
      className="fixed top-4 left-4 z-30 inline-flex size-9 cursor-pointer items-center justify-center rounded-none border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground"
    >
      <PanelRight className="size-4" />
    </button>
  )
}

function StudentShellContent({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const user = useSessionUser()
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  const staff = isStaff(user.role)
  const admin = isAdmin(user.role)
  const activeTest: NavItem = { name: "Start a Practice Test", href: "/skills/listening", icon: Compass }

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true)
    setLogoutError(null)
    const { error } = await apiFetch("/auth/logout", { method: "POST" })
    if (error) {
      // Never fake success: the httpOnly cookie was not cleared server-side,
      // so redirecting would leave the user "signed in" again on next visit.
      setLogoutError(error.message)
      setIsLoggingOut(false)
      return
    }
    // Never leave an exam draft (essay text, answers) on a shared machine.
    useExamStore.getState().clearExamDraft()
    setIsLoggingOut(false)
    setShowLogoutModal(false)
    router.push("/login")
  }

  return (
    <SidebarProvider>
      {/* Mobile top bar — PanelRight opens the drawer. */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4 md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="Speakio dashboard">
          <SpeakioMark className="size-7" />
          <span className="text-sm font-semibold tracking-tight">SPEAKIO</span>
        </Link>
        <SidebarPanelToggle />
      </div>

      <Sidebar side="left" collapsible="offcanvas" className="border-r border-border bg-surface-subtle">
        <SidebarHeader className="flex-row items-center justify-between gap-2 border-b border-border p-2">
          <Link href="/dashboard" className="flex items-center gap-3" aria-label="Speakio dashboard">
            <SpeakioMark className="size-8 shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-foreground">SPEAKIO</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                IELTS Academic
              </span>
            </div>
          </Link>
          {/* PanelRight closes the drawer on mobile / collapses on desktop. */}
          <SidebarPanelToggle />
        </SidebarHeader>

        <SidebarContent>
          <NavSection label="Preparation" items={studentNavItems} />
          <NavSection label="Practice" items={[activeTest]} />
          {staff && (
            <NavSection
              label="Administration"
              items={admin ? staffNavItems : staffNavItems.filter((i) => i.name !== "Agent Ops")}
            />
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2 rounded-none border border-border bg-surface-subtle p-3">
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-foreground">{user.name}</span>
                <span className="rounded-none border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase text-primary">
                  {user.role}
                </span>
              </div>
              <span className="truncate text-[11px] text-muted-foreground">
                Target: <span className="font-medium text-primary">Band {(user.targetBand ?? 7.0).toFixed(1)}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutModal(true)}
              aria-label="Sign out"
              className="shrink-0 cursor-pointer gap-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Desktop: when the rail is collapsed this is the only way back in. */}
      <CollapsedRailReveal />

      <SidebarInset className="min-w-0 pt-14 md:pt-0">{children}</SidebarInset>

      <LogoutConfirmModal
        isOpen={showLogoutModal}
        isLoggingOut={isLoggingOut}
        logoutError={logoutError}
        user={user}
        onConfirm={handleConfirmLogout}
        onCancel={() => {
          setShowLogoutModal(false)
          setLogoutError(null)
        }}
      />
    </SidebarProvider>
  )
}

function LogoutConfirmModal({
  isOpen,
  isLoggingOut,
  logoutError,
  user,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean
  isLoggingOut: boolean
  logoutError: string | null
  user: SessionUser
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmationModal
      isOpen={isOpen}
      title="Sign Out of Speakio?"
      description={
        logoutError
          ? `Sign out failed: ${logoutError} Your session is still active — please try again.`
          : "Are you sure you want to sign out? Your session will be terminated and you will need to sign in again to access your practice modules."
      }
      intent={logoutError ? "destructive" : "warning"}
      confirmLabel="Sign Out"
      cancelLabel="Stay Signed In"
      isSubmitting={isLoggingOut}
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={`User: ${user.name} (${user.email}) | Role: ${user.role}`}
    />
  )
}

export function StudentShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <UserSessionProvider user={user}>
      <StudentShellContent>{children}</StudentShellContent>
    </UserSessionProvider>
  )
}
