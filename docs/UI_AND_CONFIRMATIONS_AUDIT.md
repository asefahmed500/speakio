# UI Layout, Tabs & Confirmation Audit

## Canonical layout (single source of truth)

`components/app/app-shell.tsx` is the only shell for authenticated pages. Both
`(student)/layout.tsx` and `(admin)/layout.tsx` render it. Route groups never
nest a second `SidebarProvider`; the exam layout is the single documented
exception (full-screen exam engine, no sidebar). Public forms share
`components/auth/auth-shell.tsx` (one gradient-bordered panel).

Hierarchy enforced everywhere:

```
AppShell → Sidebar → SidebarInset (main) → PageContainer → PageHeader → Tabs → Content
```

## Fixes applied

| Problem | Fix |
|---|---|
| Sidebar/header/footer hardcoded dark while tokens are white | Shell rewritten to `bg-card`, `border-border`, `text-foreground` |
| 7 student pages set `min-h-screen` inside the shell → nested scroll contexts | Replaced with `min-h-0`; only the exam keeps full-screen height |
| Each page invented its own width/padding | `components/app/page-container.tsx`: `PageContainer`, `PageHeader`, `TabStrip` |
| Review Monitor had a bespoke tab strip | Uses shared `TabStrip`, inside the main container, active state via `border-foreground` |
| Exact-path active nav state lost on detail routes | `pathname === href || pathname.startsWith(href + "/")` |
| Mobile header was a separate with its own theme | One fixed bar + `pt-14` on `SidebarInset`; one toggle for drawer and rail |

## Confirmations & destructive actions

`components/ui/confirmation-modal.tsx` is the single confirmation pattern and now
provides: unique ARIA ids (`useId`), initial focus on Cancel, Tab/Shift+Tab focus
trap, Escape + backdrop cancel (blocked while submitting), focus restored to the
trigger, `max-h-[calc(100vh-2rem)] overflow-y-auto` for mobile/long content,
local double-submit guard, and an inline `error` prop.

Call sites fixed to keep the dialog **open on failure** (real error shown, retry
possible), instead of fake-closing: suspend/reactivate account, delete test set,
remove question, revoke certificate, delete vocabulary item. Logout already
shows transport errors inside the dialog and disables actions while in flight.

`ExamSoundCheckModal` is intentionally non-dismissible (exam entry gate); its
escape/outside-click behavior is deliberately absent.

## Verification

- 19/19 structural/functional checks against the dev server (auth pages, shell
  pages with cookies, free question bank, typed AI speaking, forgot-password).
- 30/30 checks against the deployed Cloudflare stack (see docs/DEPLOYMENT.md).
- typecheck clean · lint 0 warnings · production build ✓.
