import { create } from "zustand"
import { persist } from "zustand/middleware"

interface AuthUiState {
  /** Draft email kept in sync across sign-in / register so users never retype it. */
  emailDraft: string
  setEmailDraft: (email: string) => void
  clearEmailDraft: () => void
}

/**
 * Small persisted store for cross-page auth UX state.
 * Form field state itself stays in react-hook-form; this only carries
 * state that must survive navigation between /login and /register.
 *
 * `skipHydration` keeps the SSR render (empty draft) in sync with the
 * hydration render — pages rehydrate in an effect after mount.
 */
export const useAuthUiStore = create<AuthUiState>()(
  persist(
    (set) => ({
      emailDraft: "",
      setEmailDraft: (email) => set({ emailDraft: email }),
      clearEmailDraft: () => set({ emailDraft: "" }),
    }),
    { name: "speakio.auth-ui", skipHydration: true }
  )
)
