"use client"

import { useEffect, useState } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertCircle, KeyRound, Trash2, UserPlus } from "lucide-react"
import { db } from "@/lib/firebase"
import { useAdminAuth } from "@/lib/admin-auth"

interface SubAdmin {
  uid: string
  username: string
  active: boolean
  createdAt: string
}

type DialogState =
  | { kind: "create" }
  | { kind: "password"; admin: SubAdmin }
  | null

export function SubAdminsManager() {
  const { authFetch } = useAdminAuth()
  const [admins, setAdmins] = useState<SubAdmin[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleting, setDeleting] = useState<SubAdmin | null>(null)

  useEffect(() => {
    const q = query(collection(db, "admins"), where("role", "==", "sub"))
    return onSnapshot(
      q,
      (snapshot) => {
        setAdmins(
          snapshot.docs
            .map((d) => ({
              uid: d.id,
              username: d.data().username ?? "",
              active: d.data().active !== false,
              createdAt: d.data().createdAt ?? "",
            }))
            .sort((a, b) => a.username.localeCompare(b.username))
        )
        setIsLoading(false)
      },
      (err) => {
        setError(err.message)
        setIsLoading(false)
      }
    )
  }, [])

  // Calls a sub-admin API endpoint; returns an error message or null.
  const callApi = async (url: string, method: string, body?: unknown): Promise<string | null> => {
    try {
      const res = await authFetch(url, { method, body: body ? JSON.stringify(body) : undefined })
      if (res.ok) return null
      const data = await res.json().catch(() => ({}))
      return data.error ?? "Request failed. Please try again."
    } catch {
      return "Could not reach the server. Please try again."
    }
  }

  const openDialog = (state: DialogState) => {
    setUsername("")
    setPassword("")
    setFormError(null)
    setDialog(state)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dialog) return
    setIsSaving(true)
    const err =
      dialog.kind === "create"
        ? await callApi("/api/sub-admins", "POST", { username, password })
        : await callApi(`/api/sub-admins/${dialog.admin.uid}`, "PATCH", { password })
    setIsSaving(false)
    if (err) return setFormError(err)
    setDialog(null)
  }

  const handleToggleActive = async (admin: SubAdmin, active: boolean) => {
    const err = await callApi(`/api/sub-admins/${admin.uid}`, "PATCH", { active })
    if (err) setError(err)
  }

  const handleDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    const err = await callApi(`/api/sub-admins/${target.uid}`, "DELETE")
    if (err) setError(err)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Sub-admins ({admins.length})</span>
            <Button size="sm" onClick={() => openDialog({ kind: "create" })}>
              <UserPlus className="mr-2 h-4 w-4" /> Add sub-admin
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((a) => (
                    <TableRow key={a.uid}>
                      <TableCell className="font-medium">{a.username}</TableCell>
                      <TableCell>
                        <Badge className={a.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                          {a.active ? "Active" : "Deactivated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-NG") : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={a.active}
                          onCheckedChange={(checked) => handleToggleActive(a, checked)}
                          aria-label={`${a.active ? "Deactivate" : "Activate"} ${a.username}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "password", admin: a })}>
                            <KeyRound className="mr-1 h-4 w-4" /> Reset password
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(a)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {admins.length === 0 && (
                <div className="py-8 text-center text-gray-400">
                  No sub-admins yet. Add one to give a staff member dashboard access.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "password" ? `Reset password for ${dialog.admin.username}` : "Add sub-admin"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "password"
                ? "They will be signed out and must use the new password."
                : "Share the username and password with the staff member. They can use every section except Sub-admins."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSave}>
            {dialog?.kind === "create" && (
              <div className="space-y-2">
                <Label htmlFor="sub-username">Username</Label>
                <Input
                  id="sub-username"
                  autoCapitalize="none"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. amaka"
                  required
                />
                <p className="text-xs text-muted-foreground">3-30 characters: letters, numbers, dot, dash or underscore.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="sub-password">{dialog?.kind === "password" ? "New password" : "Password"}</Label>
              <Input
                id="sub-password"
                type="text"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : dialog?.kind === "password" ? "Set password" : "Create sub-admin"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose dashboard access immediately. To block access temporarily, turn off their Access switch instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
