/**
 * Centralized Enterprise Role-Based Access Control (RBAC) & Permission Engine.
 * Granular permission identifiers and role mappings for Speakio.
 */

export type Role = "USER" | "ADMIN"

export type Permission =
  // Tests & Question Bank
  | "tests:take"
  | "tests:view"
  | "tests:manage"
  | "tests:create"
  | "tests:delete"
  // Exam Attempts & Submissions
  | "attempts:create"
  | "attempts:view_own"
  | "attempts:view_all"
  | "attempts:rescore"
  // Scoring & AI Agent Operations
  | "scoring:view"
  | "scoring:override"
  | "scoring:retry"
  | "agent_ops:view"
  | "review_queue:view"
  | "review_queue:action"
  // Certificates & Verification
  | "certificates:view_own"
  | "certificates:issue"
  | "certificates:revoke"
  // User Management
  | "users:view"
  | "users:manage_role"
  | "users:manage_status"
  | "users:delete"
  // Student Tools
  | "study_plan:manage"
  | "vocabulary:manage"

/**
 * Standard role-to-permission mapping.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  USER: [
    "tests:take",
    "tests:view",
    "attempts:create",
    "attempts:view_own",
    "certificates:view_own",
    "study_plan:manage",
    "vocabulary:manage",
  ],
  ADMIN: [
    "tests:take",
    "tests:view",
    "tests:manage",
    "tests:create",
    "tests:delete",
    "attempts:create",
    "attempts:view_own",
    "attempts:view_all",
    "attempts:rescore",
    "scoring:view",
    "scoring:override",
    "scoring:retry",
    "agent_ops:view",
    "review_queue:view",
    "review_queue:action",
    "certificates:view_own",
    "certificates:issue",
    "certificates:revoke",
    "users:view",
    "users:manage_role",
    "users:manage_status",
    "users:delete",
    "study_plan:manage",
    "vocabulary:manage",
  ],
}

/**
 * Checks whether a given role possesses a specific permission.
 */
export function hasPermission(role: Role | string | undefined | null, permission: Permission): boolean {
  if (!role) return false
  const validRole = role as Role
  const permissions = ROLE_PERMISSIONS[validRole]
  return permissions ? permissions.includes(permission) : false
}

/**
 * Checks whether a role possesses ALL required permissions.
 */
export function hasAllPermissions(role: Role | string | undefined | null, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p))
}

/**
 * Checks whether a role possesses AT LEAST ONE of the specified permissions.
 */
export function hasAnyPermission(role: Role | string | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

/**
 * Checks whether the user has a specific role.
 */
export function hasRole(currentRole: Role | string | undefined | null, requiredRole: Role): boolean {
  return currentRole === requiredRole
}

/**
 * Checks whether the user has any of the acceptable roles.
 */
export function hasAnyRole(currentRole: Role | string | undefined | null, acceptableRoles: Role[]): boolean {
  if (!currentRole) return false
  return acceptableRoles.includes(currentRole as Role)
}

/**
 * Route-to-permission gate checks.
 */
export const ROUTE_PERMISSION_MAP: Record<string, Permission> = {
  "/overview": "agent_ops:view",
  "/agent-ops": "agent_ops:view",
  "/review-queue": "review_queue:view",
  "/users": "users:view",
  "/students": "users:view",
  "/question-bank": "tests:manage",
  "/dashboard": "tests:take",
  "/study-plan": "study_plan:manage",
  "/vocabulary": "vocabulary:manage",
  "/certificates": "certificates:view_own",
  "/results": "attempts:view_own",
}

/**
 * Validates whether a user role has access to a specific application route.
 */
export function canAccessRoute(role: Role | string | undefined | null, pathname: string): boolean {
  // Check exact prefix matches
  for (const [route, permission] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return hasPermission(role, permission)
    }
  }
  return true
}
