"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lock, Truck } from "lucide-react"
import { useAdminAuth } from "@/lib/admin-auth"

// Shows the dashboard only to a signed-in admin. Before the main admin
// exists it shows the one-time setup form instead of the login form.
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, profile, isLoading } = useAdminAuth()
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

  useEffect(() => {
    if (user) return
    fetch("/api/admin-auth/status")
      .then((r) => r.json())
      .then((d) => setSetupRequired(!!d.setupRequired))
      .catch(() => setSetupRequired(false))
  }, [user])

  if (isLoading || (!user && setupRequired === null)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (user && profile) return <>{children}</>

  return <AdminLoginForm setupMode={!!setupRequired} onSetupDone={() => setSetupRequired(false)} />
}

function AdminLoginForm({ setupMode, onSetupDone }: { setupMode: boolean; onSetupDone: () => void }) {
  const { signIn, error } = useAdminAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (setupMode) {
      if (password !== confirm) return setFormError("Passwords do not match.")
      setIsSubmitting(true)
      try {
        const res = await fetch("/api/admin-auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setFormError(data.error ?? "Setup failed. Please try again.")
          if (res.status === 409) onSetupDone()
          return
        }
        onSetupDone()
        await signIn(username, password)
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    setIsSubmitting(true)
    await signIn(username, password)
    setIsSubmitting(false)
  }

  const message = formError ?? error

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Truck className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle>{setupMode ? "Create main admin" : "Admin sign in"}</CardTitle>
          <CardDescription>
            {setupMode
              ? "This is a one-time step. The account you create here can add and manage sub-admins."
              : "Sign in with the username and password given to you."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="admin-username">Username</Label>
              <Input
                id="admin-username"
                autoComplete="username"
                autoCapitalize="none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete={setupMode ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {setupMode && (
              <div className="space-y-2">
                <Label htmlFor="admin-confirm">Confirm password</Label>
                <Input
                  id="admin-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            )}
            {message && <p className="text-sm text-destructive">{message}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <Lock className="mr-2 h-4 w-4" />
              {isSubmitting ? "Please wait..." : setupMode ? "Create account" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
