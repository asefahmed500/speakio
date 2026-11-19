"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BookOpen, Headphones, FileText, Mic, Award, BarChart3, Cpu, LogOut,
  PanelRight, Compass, CheckCircle2, Calendar, BookMarked, ListChecks,
  UserCog, GraduationCap, LayoutDashboard, Database, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, useSidebar,
} from "@/components/ui/sidebar"
import { UserSessionProvider, useSessionUser } from "@/components/user-session-provider"
import { SpeakioMark } from "@/components/logo"
import { apiFetch } from "@/lib/api-client"
import { useExamStore } from "@/stores/use-exam-store"
import { isAdmin, type SessionUser } from "@/lib/user"
import { canAccessRoute } from "@/lib/rbac/permissions"

const studentNavItems = [
  { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
  { name: "My Results", href: "/results", icon: ListChecks },
  { name: "Study Planner", href: "/study-plan", icon: Calendar },
  { name: "Vocabulary Studio", href: "/vocabulary", icon: BookMarked },
  { name: "Listening", href: "/skills/listening", icon: Headphones },
  { name: "Reading", href: "/skills/reading", icon: BookOpen },
  { name: "Writing AI", href: "/skills/writing", icon: FileText, badge: "AI Graded" },
  { name: "Speaking", href: "/skills/speaking", icon: Mic },
  { name: "Certificates", href: "/certificates", icon: Award },
  { name: "Profile", href: "/profile", icon: UserCog },
]
const adminNavItems = [
  { name: "Overview", href: "/overview", icon: LayoutDashboard },
  { name: "AI Reviews", href: "/review-queue", icon: CheckCircle2 },
  { name: "Agent Ops", href: "/agent-ops", icon: Cpu },
  { name: "Students", href: "/students", icon: GraduationCap },
  { name: "Users", href: "/users", icon: Users },
  { name: "Question Bank", href: "/question-bank", icon: Database },
]

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  badge?: string
}

/** Single open/close control for the sidebar on every breakpoint. */
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
      <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
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
                  className="h-9 rounded-none border border-transparent px-3 text-xs data-active:border-border data-active:bg-surface-subtle"
                >
                  <Icon className="text-muted-foreground data-[active=true]:text-foreground" />
                  <span className="text-foreground/80">{item.name}</span>
                </SidebarMenuButton>
                {item.badge && (
                  <SidebarMenuBadge className="rounded-none border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
      aria-label="Open navigation sidebar"
      className="fixed top-4 left-4 z-30 inline-flex size-9 cursor-pointer items-center justify-center rounded-none border border-border bg-card text-muted-foreground shadow-xs"
    >
      <PanelRight className="size-4" />
    </button>
  )
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const user = useSessionUser()
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const admin = isAdmin(user.role)

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true)
    setLogoutError(null)
    const { error } = await apiFetch("/auth/logout", { method: "POST" })
    if (error) {
      setLogoutError(error.message)
      setIsLoggingOut(false)
      return
    }
    useExamStore.getState().clearExamDraft()
    setIsLoggingOut(false)
    setShowLogoutModal(false)
    router.push("/login")
  }

  return (
    <SidebarProvider>
      {/* Mobile header — one fixed bar, main area gets matching top padding. */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur-sm md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="Speakio dashboard">
          <SpeakioMark className="size-7" />
          <span className="text-sm font-semibold tracking-tight">SPEAKIO</span>
        </Link>
        <SidebarPanelToggle />
      </div>

      <Sidebar side="left" collapsible="offcanvas" className="border-r border-border bg-card">
        <SidebarHeader className="flex-row items-center justify-between gap-2 border-b border-border p-2">
          <Link href="/dashboard" className="flex items-center gap-3" aria-label="Speakio dashboard">
            <SpeakioMark className="size-8 shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight">SPEAKIO</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">IELTS Academic</span>
            </div>
          </Link>
          <SidebarPanelToggle />
        </SidebarHeader>

        <SidebarContent className="px-1 py-2">
          <NavSection
            label="Preparation"
            items={studentNavItems.filter((item) => canAccessRoute(user.role, item.href))}
          />
          <NavSection label="Practice" items={[{ name: "Start a Practice Test", href: "/skills/listening", icon: Compass }]} />
          {admin && (
            <NavSection
              label="Administration"
              items={adminNavItems.filter((item) => canAccessRoute(user.role, item.href))}
            />
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2 border border-border bg-surface-subtle p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-semibold">{user.name}</span>
                <span className="border border-border bg-card px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                  {user.role}
                </span>
              </div>
              <span className="truncate text-[11px] text-muted-foreground">
                Target: <span className="font-medium">Band {(user.targetBand ?? 7.0).toFixed(1)}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutModal(true)}
              aria-label="Sign out"
              className="shrink-0 cursor-pointer gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <CollapsedRailReveal />

      {/* One main content area for every route inside this shell. */}
      <SidebarInset className="flex min-w-0 flex-1 flex-col bg-background pt-14 md:pt-0">
        {children}
      </SidebarInset>

      <ConfirmationModal
        isOpen={showLogoutModal}
        title="Sign out?"
        description={
          logoutError
            ? `Sign out failed: ${logoutError} Your session is still active — please try again.`
            : "You will be signed out of all devices. Your saved practice work stays in your account."
        }
        intent={logoutError ? "destructive" : "warning"}
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        isSubmitting={isLoggingOut}
        onConfirm={handleConfirmLogout}
        onCancel={() => {
          setShowLogoutModal(false)
          setLogoutError(null)
        }}
        details={`${user.name} (${user.email})`}
      />
    </SidebarProvider>
  )
}

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <UserSessionProvider user={user}>
      <AppShellContent>{children}</AppShellContent>
    </UserSessionProvider>
  )
}
