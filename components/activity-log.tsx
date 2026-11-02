"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { db } from "@/lib/firebase"

interface ActivityEntry {
  id: string
  uid: string
  username: string
  action: string
  at: string
  [key: string]: unknown
}

const ALL = "__all__"
// Fields shown as details (everything except who/what/when).
const HIDDEN = new Set(["id", "uid", "username", "action", "at", "targetId"])

const COLLECTION_LABELS: Record<string, string> = {
  instantPickups: "Instant pickup",
  pickupRequests: "Scheduled pickup",
  wasteBagOrders: "Waste bag order",
  upgradeRequests: "Plan request",
  supportTickets: "Support ticket",
  subscribers: "Subscriber",
  subscriptionVisits: "Subscription visit",
  collectors: "Collector",
}

function describe(entry: ActivityEntry): string {
  return Object.entries(entry)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "")
    .map(([k, v]) => (k === "collection" ? COLLECTION_LABELS[String(v)] ?? String(v) : `${k}: ${v}`))
    .join(" · ")
}

export function ActivityLog({ searchQuery = "" }: { searchQuery?: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adminFilter, setAdminFilter] = useState(ALL)

  useEffect(() => {
    const q = query(collection(db, "activityLog"), orderBy("at", "desc"), limit(300))
    return onSnapshot(
      q,
      (snap) => setEntries(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ActivityEntry)),
      (err) => {
        console.error("activity log error:", err)
        setError("Could not load the activity log. Check that the Firestore rule for activityLog is published.")
      }
    )
  }, [])

  const admins = useMemo(() => [...new Set(entries.map((e) => e.username).filter(Boolean))].sort(), [entries])
  const q = searchQuery.trim().toLowerCase()
  const visible = entries.filter((e) =>
    (adminFilter === ALL || e.username === adminFilter) &&
    (!q || `${e.username} ${e.action} ${describe(e)}`.toLowerCase().includes(q))
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span>Recent activity ({visible.length})</span>
          <Select value={adminFilter} onValueChange={setAdminFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Admin" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All admins</SelectItem>
              {admins.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(e.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </TableCell>
                <TableCell><Badge variant="outline">{e.username || "—"}</Badge></TableCell>
                <TableCell className="text-sm font-medium">{e.action}</TableCell>
                <TableCell className="max-w-md text-sm text-muted-foreground">{describe(e)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!error && visible.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
