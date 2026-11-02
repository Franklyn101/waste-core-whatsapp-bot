"use client"

import { useEffect, useState } from "react"
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore"
import { Megaphone, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { db } from "@/lib/firebase"
import { useAdminAuth } from "@/lib/admin-auth"

const AUDIENCES = [
  { id: "all", label: "All customers", hint: "Everyone who has booked or messaged the bot" },
  { id: "subscribers", label: "Active subscribers", hint: "Business and household plans" },
  { id: "business", label: "Business subscribers", hint: "" },
  { id: "household", label: "Household subscribers", hint: "" },
  { id: "recent", label: "Booked in the last 60 days", hint: "" },
]
const MAX = 900

interface Broadcast {
  id: string
  audience: string
  message: string
  total: number
  sent: number
  failed: number
  status: string
  createdBy: string
  createdAt: string
}

export function BroadcastsManager() {
  const { authFetch } = useAdminAuth()
  const [audience, setAudience] = useState("subscribers")
  const [message, setMessage] = useState("")
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [history, setHistory] = useState<Broadcast[]>([])

  useEffect(() => {
    const q = query(collection(db, "broadcasts"), orderBy("createdAt", "desc"), limit(20))
    return onSnapshot(q, (snap) => setHistory(snap.docs.map((d) => ({ ...(d.data() as Omit<Broadcast, "id">), id: d.id }))),
      (err) => console.error("broadcasts error:", err))
  }, [])

  // Live count of who will receive it.
  useEffect(() => {
    setCount(null)
    let stale = false
    authFetch("/api/broadcasts", { method: "POST", body: JSON.stringify({ audience, preview: true }) })
      .then((r) => r.json())
      .then((d) => { if (!stale) setCount(typeof d.count === "number" ? d.count : null) })
      .catch(() => {})
    return () => { stale = true }
    // authFetch is a new function on every render; only the audience matters.
  }, [audience]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch("/api/broadcasts", { method: "POST", body: JSON.stringify({ audience, message }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not send the broadcast.")
      setNotice(`Sending to ${data.count} customer${data.count === 1 ? "" : "s"}. Progress shows below.`)
      setMessage("")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const label = AUDIENCES.find((a) => a.id === audience)?.label ?? audience
  const tooShort = message.trim().length < 5

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> New broadcast</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Send to</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger className="w-full sm:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {count == null ? "Counting…" : `${count} customer${count === 1 ? "" : "s"}`}
              {AUDIENCES.find((a) => a.id === audience)?.hint ? ` · ${AUDIENCES.find((a) => a.id === audience)?.hint}` : ""}
              {" "}· customers who unsubscribed are skipped
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="broadcast-message">Message</Label>
            <Textarea id="broadcast-message" rows={4} maxLength={MAX} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. there will be no pickups on Monday 1 December (public holiday). Pickups resume on Tuesday." />
            <p className="text-xs text-muted-foreground">
              Customers see: <i>Hello [name], {message.trim() || "your message"}</i> · {message.length}/{MAX} · line breaks become spaces
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-green-700">{notice}</p>}
          <Button disabled={busy || tooShort || !count} onClick={() => { setNotice(null); setConfirming(true) }}>
            <Megaphone className="mr-2 h-4 w-4" /> {busy ? "Sending…" : `Send to ${count ?? "…"} customers`}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent broadcasts</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 && <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>}
          {history.map((b) => (
            <div key={b.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{AUDIENCES.find((a) => a.id === b.audience)?.label ?? b.audience}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(b.createdAt).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {b.createdBy}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{b.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge className={b.status === "done" ? "bg-green-100 text-green-800" : b.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>
                  {b.status === "sending" ? "Sending…" : b.status}
                </Badge>
                <span>{b.sent} of {b.total} sent</span>
                {b.failed > 0 && <span className="text-destructive">{b.failed} failed</span>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {count} customers?</AlertDialogTitle>
            <AlertDialogDescription>
              {label}: “Hello [name], {message.trim()}”. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={send}>Send now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
