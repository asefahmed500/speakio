/**
 * Typed API client for the Speakio NestJS backend.
 * All calls are credential-authenticated via the httpOnly access_token cookie.
 */

export const API_URL =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? `${window.location.protocol}//${window.location.hostname}:4040`
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:4040"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

interface ApiResult<T> {
  data: T | null
  error: ApiError | null
  networkError: boolean
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message
    if (typeof message === "string") return message
    if (Array.isArray(message)) return message.join(", ")
  }
  return fallback
}

const DEFAULT_TIMEOUT_MS = 15_000

// Guards against redirect loops when several in-flight requests all hit 401.
let redirectingToLogin = false

function redirectToLogin() {
  if (redirectingToLogin || typeof window === "undefined") return
  redirectingToLogin = true
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.assign(`/login?next=${next}`)
}

// Single-flight silent refresh: concurrent 401s share one /auth/refresh call
// and one retry each, instead of stampeding the endpoint.
let refreshInFlight: Promise<boolean> | null = null

function tryRefreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        })
        return res.ok
      } catch {
        return false
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; timeoutMs?: number },
  allowRefresh: boolean
): Promise<ApiResult<T>> {
  const { json, headers, timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const signal =
    timeoutMs > 0
      ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean) as AbortSignal[])
      : rest.signal
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...rest,
      signal,
      credentials: "include",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })

    if (res.status === 204) return { data: null, error: null, networkError: false }

    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const fallbackByStatus: Record<number, string> = {
        400: "The request was invalid. Please check your input.",
        401: "Your session has expired. Please sign in again.",
        403: "You do not have permission to perform this action.",
        404: "The requested resource was not found.",
        409: "This action conflicts with the current state. Refresh and try again.",
        429: "Too many requests. Please wait a moment and try again.",
        500: "Something went wrong on our side. Please try again.",
      }
      // Centralized session-expiry handling: try one silent refresh before
      // giving up. Auth endpoints (login/register/me/refresh) render their
      // own 401 states and must not trigger a redirect.
      if (res.status === 401 && !path.startsWith("/auth/")) {
        if (allowRefresh && (await tryRefreshSession())) {
          return request<T>(path, init, false)
        }
        redirectToLogin()
      }
      return {
        data: null,
        error: new ApiError(res.status, extractMessage(body, fallbackByStatus[res.status] ?? `Request failed (${res.status})`)),
        networkError: false,
      }
    }
    if (body === null) {
      return {
        data: null,
        error: new ApiError(res.status, "The server returned a malformed response. Please try again."),
        networkError: false,
      }
    }
    return { data: body as T, error: null, networkError: false }
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return {
        data: null,
        error: new ApiError(0, "The request timed out. Check your connection and try again."),
        networkError: true,
      }
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        data: null,
        error: new ApiError(0, "Request cancelled."),
        networkError: true,
      }
    }
    return {
      data: null,
      error: new ApiError(0, "Unable to reach the Speakio service. Check your connection and try again."),
      networkError: true,
    }
  }
}

/**
 * Performs an API request. Never throws for HTTP/network failures — callers
 * receive a discriminated result so loading / error / empty states can be
 * rendered deliberately.
 *
 * Auth expiry is centralized here: a 401 on a non-auth endpoint triggers one
 * silent POST /auth/refresh + retry; only if that fails does the caller get
 * the 401 and the full-page redirect to /login?next=… (clearing stale client
 * state). Pass `timeoutMs: 0` for long-running calls such as exam submit or
 * scoring.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; timeoutMs?: number } = {}
): Promise<ApiResult<T>> {
  return request<T>(path, init, true)
}
