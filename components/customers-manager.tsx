"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDocs, setDoc } from "firebase/firestore"
import { MessageCircle, RefreshCw, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { MapPinLink } from "@/components/map-pin-link"
import { db } from "@/lib/firebase"
import { logActivity } from "@/lib/activity"
import { loadRevenue, METHOD_LABELS, type RevenueEntry } from "@/lib/revenue"
import { findPlan, planFullLabel } from "@/lib/subscriptions"
import { useAdminAuth } from "@/lib/admin-auth"
import { can } from "@/lib/permissions"
import type { CollectorReport, GeoPin } from "@/lib/types"
import { ProofPhoto } from "@/components/proof-photo"

// Numbers are stored in several shapes (whatsapp:+234..., 0803...); this is
// the one key a customer is grouped by: international digits, no "+".
export function phoneKey(phone: string): string {
  let digits = String(phone ?? "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("0")) digits = `234${digits.slice(1)}`
  else if (digits.length === 10 && !digits.startsWith("0")) digits = `234${digits}`
  return digits
}

const SOURCES: { col: string; label: string }[] = [
  { col: "instantPickups", label: "Instant pickup" },
  { col: "pickupRequests", label: "Scheduled pickup" },
  { col: "subscriptionVisits", label: "Subscription visit" },
  { col: "upgradeRequests", label: "Monthly plan (WhatsApp)" },
  { col: "subscribers", label: "Subscriber" },
  { col: "wasteBagOrders", label: "Waste bag order" },
  { col: "supportTickets", label: "Support ticket" },
]

interface HistoryItem {
  id: string
  col: string
  label: string
  date: string
  status: string
  detail: string
  amount: number | null
  rating: number | null
  ratingComment: string
  proof: CollectorReport | null
}

interface Customer {
  key: string
  name: string
  phone: string
  address: string
  location: GeoPin | null
  items: HistoryItem[]
  payments: RevenueEntry[]
  spent: number
  lastActivity: string
  subscription: { label: string; paidUntil: string | null; status: string } | null
  avgRating: number | null
}

function itemDate(data: any): string {
  return String(data.pickupDate || data.createdAt || data.startDate || "").slice(0, 10)
}

function itemDetail(col: string, data: any): string {
  if (col === "subscribers" || col === "upgradeRequests") {
    const plan = findPlan(data.planId || data.plan || String(data.serviceType ?? "").replace(/^upgrade_/, ""))
    return [plan ? planFullLabel(plan) : "", data.paidUntil ? `paid until ${data.paidUntil}` : ""].filter(Boolean).join(" · ")
  }
  if (col === "wasteBagOrders") return `${data.bagSize ?? ""} × ${data.quantity ?? 1}`
  if (col === "supportTickets") return `${data.category ?? ""}${data.message ? `: ${String(data.message).slice(0, 80)}` : ""}`
  return [data.bagCount ? `${data.bagCount} bag${data.bagCount > 1 ? "s" : ""}` : data.serviceLabel ?? "", data.timeWindow ?? "", data.collectorName ? `collector ${data.collectorName}` : ""]
    .filter(Boolean).join(" · ")
}

async function loadCustomers(): Promise<Customer[]> {
  const [snaps, revenue] = await Promise.all([
    Promise.all(SOURCES.map((s) => getDocs(collection(db, s.col)))),
    loadRevenue(),
  ])
  const map = new Map<string, Customer>()
  const get = (key: string): Customer => {
    if (!map.has(key)) {
      map.set(key, { key, name: "", phone: `+${key}`, address: "", location: null, items: [], payments: [], spent: 0, lastActivity: "", subscription: null, avgRating: null })
    }
    return map.get(key)!
  }
  snaps.forEach((snap, i) => {
    const { col, label } = SOURCES[i]
    for (const d of snap.docs) {
      const data = d.data()
      const key = phoneKey(data.customerPhone)
      if (!key) continue
      const c = get(key)
      const date = itemDate(data)
      if (!c.name && data.customerName) c.name = data.customerName
      // Latest address (and pin) seen for this customer.
      const address = data.address || data.deliveryAddress
      if (address && date >= (c.lastActivity || "")) {
        c.address = address
        if (data.location) c.location = data.location
      }
      if (date > c.lastActivity) c.lastActivity = date
      if ((col === "subscribers" && data.status !== "cancelled") || (col === "upgradeRequests" && data.status !== "cancelled" && !c.subscription)) {
        const plan = findPlan(data.planId || data.plan || "")
        c.subscription = { label: plan ? planFullLabel(plan) : "Subscription", paidUntil: data.paidUntil ?? null, status: data.status ?? "" }
      }
      c.items.push({
        id: d.id, col, label, date,
        status: data.status ?? "",
        detail: itemDetail(col, data),
        amount: Number(data.totalAmount) || null,
        rating: data.rating?.stars ?? null,
        ratingComment: data.rating?.comment ?? "",
        proof: data.collectorReport?.photoUrl ? data.collectorReport : null,
      })
    }
  })
  for (const p of revenue.entries) {
    const key = phoneKey(p.customerPhone)
    if (!key) continue
    const c = get(key)
    c.payments.push(p)
    c.spent += p.amount
  }
  for (const c of map.values()) {
    c.items.sort((a, b) => b.date.localeCompare(a.date))
    const ratings = c.items.map((i) => i.rating).filter((r): r is number => r != null)
    c.avgRating = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null
  }
  return [...map.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`
const prettyDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso || "—" : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
}

export function CustomersManager({ searchQuery = "" }: { searchQuery?: string }) {
  const { profile } = useAdminAuth()
  const showMoney = can(profile, "viewRevenue")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noteDraft, setNoteDraft] = useState("")
  const [noteSaved, setNoteSaved] = useState(false)

  const refresh = () => {
    setLoading(true)
    Promise.all([loadCustomers(), getDocs(collection(db, "customerNotes"))])
      .then(([list, notesSnap]) => {
        setCustomers(list)
        setNotes(Object.fromEntries(notesSnap.docs.map((d) => [d.id, String(d.data().text ?? "")])))
        setError(null)
      })
      .catch((err) => { console.error("customers load failed", err); setError("Could not load customers. Please try again.") })
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  const q = searchQuery.trim().toLowerCase()
  const visible = useMemo(
    () => customers.filter((c) => !q || `${c.name} ${c.phone} ${c.address}`.toLowerCase().includes(q)),
    [customers, q]
  )

  const open = (c: Customer) => {
    setSelected(c)
    setNoteDraft(notes[c.key] ?? "")
    setNoteSaved(false)
  }

  const saveNote = async () => {
    if (!selected) return
    try {
      await setDoc(doc(db, "customerNotes", selected.key), { text: noteDraft.trim(), updatedAt: new Date().toISOString(), updatedBy: profile?.username ?? "" })
      setNotes((n) => ({ ...n, [selected.key]: noteDraft.trim() }))
      setNoteSaved(true)
      logActivity("Edited customer note", { target: selected.name || selected.phone })
    } catch (err) {
      console.error("note save failed", err)
      setError("Could not save the note. Check that the Firestore rule for customerNotes is published.")
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Customers ({visible.length})</span>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
                {showMoney && <TableHead className="text-right">Spent</TableHead>}
                <TableHead>Rating</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => (
                <TableRow key={c.key} className="cursor-pointer" onClick={() => open(c)}>
                  <TableCell>
                    <div className="font-medium">{c.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.phone}</div>
                    {notes[c.key] && <div className="mt-0.5 max-w-56 truncate text-[11px] text-amber-700">📝 {notes[c.key]}</div>}
                  </TableCell>
                  <TableCell>
                    {c.subscription ? (
                      <div>
                        <div className="text-sm">{c.subscription.label}</div>
                        {c.subscription.paidUntil && <div className="text-xs text-muted-foreground">Paid until {prettyDate(c.subscription.paidUntil)}</div>}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">{c.items.filter((i) => i.col !== "supportTickets").length}</TableCell>
                  {showMoney && <TableCell className="text-right font-medium">{c.spent ? naira(c.spent) : "—"}</TableCell>}
                  <TableCell>
                    {c.avgRating != null ? (
                      <span className="inline-flex items-center gap-1 text-sm"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{c.avgRating.toFixed(1)}</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{prettyDate(c.lastActivity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No customers found.</p>}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name || selected.phone}</SheetTitle>
                <SheetDescription>{selected.phone}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-8">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <a href={`https://wa.me/${selected.key}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-white hover:bg-green-700">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                  {selected.address && <span className="text-muted-foreground">📍 {selected.address}</span>}
                  <MapPinLink pin={selected.location} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-bold">{selected.items.filter((i) => i.col !== "supportTickets").length}</div>
                    <div className="text-xs text-muted-foreground">Bookings</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-bold">{showMoney ? naira(selected.spent) : "—"}</div>
                    <div className="text-xs text-muted-foreground">Spent</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-bold">{selected.avgRating != null ? `${selected.avgRating.toFixed(1)}★` : "—"}</div>
                    <div className="text-xs text-muted-foreground">Avg rating</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Admin notes</h3>
                  <Textarea rows={3} value={noteDraft} placeholder="e.g. Gate code 1234. Prefers mornings. Call before arriving."
                    onChange={(e) => { setNoteDraft(e.target.value); setNoteSaved(false) }} />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={saveNote}>Save note</Button>
                    {noteSaved && <span className="text-xs text-green-700">Saved</span>}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">History</h3>
                  <ul className="space-y-2">
                    {selected.items.map((i) => (
                      <li key={`${i.col}_${i.id}`} className="rounded-lg border p-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{i.label}</span>
                          <span className="text-xs text-muted-foreground">{prettyDate(i.date)}</span>
                        </div>
                        {i.detail && <div className="text-xs text-muted-foreground">{i.detail}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {i.status && <Badge variant="outline">{i.status}</Badge>}
                          {showMoney && i.amount != null && <span className="text-xs">{naira(i.amount)}</span>}
                          {i.rating != null && <span className="text-xs text-amber-600">{"★".repeat(i.rating)}{"☆".repeat(5 - i.rating)}</span>}
                        </div>
                        {i.ratingComment && <div className="mt-1 text-xs italic text-muted-foreground">“{i.ratingComment}”</div>}
                        <ProofPhoto report={i.proof} compact />
                      </li>
                    ))}
                  </ul>
                </div>

                {showMoney && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Payments</h3>
                    {selected.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments recorded.</p>}
                    <ul className="space-y-1 text-sm">
                      {selected.payments.map((p, idx) => (
                        <li key={idx} className="flex justify-between gap-2 border-b py-1 last:border-b-0">
                          <span>
                            {prettyDate(p.date)} · {p.service} <span className="text-muted-foreground">({METHOD_LABELS[p.method] ?? p.method})</span>
                            {p.receiptUrl && (
                              <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-green-700 hover:underline">
                                Receipt {p.receiptNumber}
                              </a>
                            )}
                          </span>
                          <span className="font-medium">{naira(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
