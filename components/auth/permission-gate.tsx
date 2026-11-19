"use client"

import React from "react"
import { useSessionUser } from "@/components/user-session-provider"
import { hasPermission, hasRole, hasAnyRole, type Permission, type Role } from "@/lib/rbac/permissions"

interface PermissionGateProps {
  permission?: Permission
  permissions?: Permission[]
  requireAll?: boolean
  role?: Role
  roles?: Role[]
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Conditionally renders UI actions, sections, or widgets based on candidate / admin permissions.
 */
export function PermissionGate({
  permission,
  permissions,
  requireAll = false,
  role,
  roles,
  fallback = null,
  children,
}: PermissionGateProps) {
  const user = useSessionUser()
  const userRole = user.role as Role

  // Role check
  if (role && !hasRole(userRole, role)) {
    return <>{fallback}</>
  }

  if (roles && !hasAnyRole(userRole, roles)) {
    return <>{fallback}</>
  }

  // Single permission check
  if (permission && !hasPermission(userRole, permission)) {
    return <>{fallback}</>
  }

  // Multiple permissions check
  if (permissions && permissions.length > 0) {
    const isAuthorized = requireAll
      ? permissions.every((p) => hasPermission(userRole, p))
      : permissions.some((p) => hasPermission(userRole, p))

    if (!isAuthorized) {
      return <>{fallback}</>
    }
  }

  return <>{children}</>
}
