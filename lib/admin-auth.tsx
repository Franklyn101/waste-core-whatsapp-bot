"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"

// Must match ADMIN_EMAIL_DOMAIN in server.js. Usernames are turned into
// these synthetic addresses for Firebase Auth; nothing is ever emailed.
const ADMIN_EMAIL_DOMAIN = "admins.wastecore.local"

export type AdminRole = "main" | "sub"

export interface AdminProfile {
  uid: string
  username: string
  role: AdminRole
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

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
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
        setUser(firebaseUser)
        setProfile({ uid: firebaseUser.uid, username: data.username ?? "", role: data.role === "main" ? "main" : "sub" })
        setError(null)
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
