"use client"

import React from "react"
import Link from "next/link"
import { ShieldAlert, ArrowLeft } from "lucide-react"

interface AccessDeniedProps {
  requiredPermission?: string
  requiredRole?: string
  title?: string
  message?: string
}

export function AccessDenied({
  requiredPermission,
  requiredRole,
  title = "Access Restricted",
  message = "You do not have the required permissions to view this resource.",
}: AccessDeniedProps) {
  return (
    <div className="flex-1 bg-[#0B0E14] text-white min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center space-y-5 backdrop-blur-xl shadow-2xl">
        <div className="size-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <ShieldAlert className="size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
          <p className="text-xs text-white/60 leading-relaxed">{message}</p>
        </div>

        {(requiredPermission || requiredRole) && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left space-y-1">
            <span className="text-[10px] uppercase font-mono tracking-wider text-white/40">Required Authorization</span>
            {requiredRole && (
              <p className="text-xs font-mono text-amber-300">Role: {requiredRole}</p>
            )}
            {requiredPermission && (
              <p className="text-xs font-mono text-amber-300">Permission: {requiredPermission}</p>
            )}
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-white text-black px-4 py-2 text-xs font-semibold hover:bg-neutral-200 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Return to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
