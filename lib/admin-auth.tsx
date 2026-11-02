"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth"
import { doc, getDoc, onSnapshot } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"

// Must match ADMIN_EMAIL_DOMAIN in server.js. Usernames are turned into
// these synthetic addresses for Firebase Auth; nothing is ever emailed.
const ADMIN_EMAIL_DOMAIN = "admins.wastecore.local"

export type AdminRole = "main" | "sub"

export interface AdminProfile {
  uid: string
  username: string
  role: AdminRole
  // Sub-admin permission switches (see lib/permissions.ts).
  permissions?: Record<string, boolean>
}

interface AdminAuthValue {
  user: User | null
  profile: AdminProfile | null
  isLoading: boolean
  error: string | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  // fetch() wrapper that sends the signed-in admin's ID token.
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null)

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Live profile listener, so permission changes and deactivation apply
  // without signing in again.
  const stopProfile = useRef<(() => void) | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      stopProfile.current?.()
      stopProfile.current = null
      setIsLoading(true)
      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setIsLoading(false)
        return
      }
      try {
        const snap = await getDoc(doc(db, "admins", firebaseUser.uid))
        const data = snap.data()
        if (!snap.exists() || !data || data.active === false) {
          setError("This account does not have dashboard access.")
          await signOut(auth)
          return
        }
        const toProfile = (d: any): AdminProfile => ({
          uid: firebaseUser.uid,
          username: d.username ?? "",
          role: d.role === "main" ? "main" : "sub",
          permissions: d.permissions ?? {},
        })
        setUser(firebaseUser)
        setProfile(toProfile(data))
        setError(null)
        stopProfile.current = onSnapshot(doc(db, "admins", firebaseUser.uid), (live) => {
          const d = live.data()
          if (!live.exists() || !d || d.active === false) {
            setError("This account does not have dashboard access.")
            signOut(auth)
            return
          }
          setProfile(toProfile(d))
        }, (err) => console.error("admin profile listener failed", err))
      } catch (err) {
        console.error("admin profile load failed", err)
        setError("Could not load your account. Please try again.")
        await signOut(auth)
      } finally {
        setIsLoading(false)
      }
    })
  }, [])

  const value: AdminAuthValue = {
    user,
    profile,
    isLoading,
    error,
    signIn: async (username, password) => {
      setError(null)
      try {
        await signInWithEmailAndPassword(auth, usernameToEmail(username), password)
      } catch (err: any) {
        const code = err?.code ?? ""
        setError(
          code === "auth/user-disabled"
            ? "This account has been deactivated. Contact the main admin."
            : code === "auth/too-many-requests"
            ? "Too many attempts. Please wait a few minutes and try again."
            : "Incorrect username or password."
        )
      }
    },
    signOut: () => signOut(auth),
    authFetch: async (url, init = {}) => {
      const token = await auth.currentUser?.getIdToken()
      return fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
    },
  }

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider")
  return ctx
}
