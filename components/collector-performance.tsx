"use client"

import { useEffect, useMemo, useState } from "react"
import { addDoc, collection, doc, onSnapshot, setDoc } from "firebase/firestore"
import { Star, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { db } from "@/lib/firebase"
import { logActivity } from "@/lib/activity"
import { useAdminAuth } from "@/lib/admin-auth"
import { can } from "@/lib/permissions"
import type { Collector, CollectorPickup } from "@/lib/types"

type Period = "month" | "lastMonth" | "all"

interface Payout {
  id: string
  collectorId: string
  amount: number
  note: string
  paidAt: string
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`

function monthRange(offset: number): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { from: iso(first), to: iso(last) }
}

interface Props {
  collectors: Collector[]
  jobs: CollectorPickup[] // instant + scheduled pickups and saved subscription visits
}

export function CollectorPerformance({ collectors, jobs }: Props) {
  const { profile } = useAdminAuth()
  const mayPay = can(profile, "recordPayments")
  const [period, setPeriod] = useState<Period>("month")
  const [rate, setRate] = useState<number>(0)
  const [rateDraft, setRateDraft] = useState("")
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [paying, setPaying] = useState<{ collector: Collector; owed: number } | null>(null)
  const [payAmount, setPayAmount] = useState("")
  const [payNote, setPayNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stopRate = onSnapshot(doc(db, "settings", "collectorPay"), (snap) => {
      const value = Number(snap.data()?.perPickup) || 0
      setRate(value)
      setRateDraft(value ? String(value) : "")
    }, (err) => console.error("pay rate error:", err))
    const stopPayouts = onSnapshot(collection(db, "collectorPayouts"), (snap) => {
      setPayouts(snap.docs.map((d) => ({ id: d.id, collectorId: d.data().collectorId, amount: Number(d.data().amount) || 0, note: d.data().note ?? "", paidAt: d.data().paidAt ?? "" })))
    }, (err) => console.error("payouts error:", err))
    return () => { stopRate(); stopPayouts() }
  }, [])

  const range = period === "month" ? monthRange(0) : period === "lastMonth" ? monthRange(-1) : null
  const inPeriod = (j: CollectorPickup) => !range || (j.pickupDate >= range.from && j.pickupDate <= range.to)

  const rows = useMemo(() => collectors.map((c) => {
    const mine = jobs.filter((j) => j.collectorId === c.id)
    const period = mine.filter(inPeriod)
    const completed = period.filter((j) => j.status === "completed").length
    const failed = period.filter((j) => j.status === "incomplete" || (j.collectorReport?.status === "failed" && j.status !== "completed")).length
    const awaiting = mine.filter((j) => j.collectorReport?.status === "done" && ["pending", "assigned", "confirmed"].includes(j.status)).length
    const open = period.filter((j) => ["pending", "assigned", "confirmed"].includes(j.status)).length
    const ratings = period.map((j) => j.rating?.stars).filter((s): s is number => typeof s === "number")
    // Pay is based on all completed jobs ever, minus everything paid out.
    const earnedAll = mine.filter((j) => j.status === "completed").length * rate
    const paidAll = payouts.filter((p) => p.collectorId === c.id).reduce((s, p) => s + p.amount, 0)
    return {
      collector: c,
      assigned: period.length,
      completed,
      failed,
      open,
      awaiting,
      rate: completed + failed ? Math.round((completed / (completed + failed)) * 100) : null,
      avgRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
      ratingCount: ratings.length,
      earnedPeriod: completed * rate,
      owed: earnedAll - paidAll,
      lastPayout: payouts.filter((p) => p.collectorId === c.id).sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0],
    }
  }).sort((a, b) => b.completed - a.completed), [collectors, jobs, payouts, rate, period]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveRate = async () => {
    const value = Number(rateDraft)
    if (!(value >= 0)) return setError("Enter a valid amount.")
    try {
      await setDoc(doc(db, "settings", "collectorPay"), { perPickup: value, updatedAt: new Date().toISOString() }, { merge: true })
      logActivity("Set collector pay rate", { amount: value })
      setError(null)
    } catch (err) {
      console.error("rate save failed", err)
      setError("Could not save the pay rate. Check that the Firestore rule for settings is published.")
    }
  }

  const openPay = (collector: Collector, owed: number) => {
    setPaying({ collector, owed })
    setPayAmount(owed > 0 ? String(owed) : "")
    setPayNote("")
  }

  const savePayout = async () => {
    if (!paying) return
    const amount = Number(payAmount)
    if (!(amount > 0)) return setError("Enter the amount paid.")
    const target = paying
    setPaying(null)
    try {
      await addDoc(collection(db, "collectorPayouts"), {
        collectorId: target.collector.id,
        collectorName: target.collector.name,
        amount,
        note: payNote.trim(),
        paidAt: new Date().toISOString(),
        paidBy: profile?.username ?? "",
      })
      logActivity("Recorded collector payout", { collection: "collectors", targetId: target.collector.id, target: target.collector.name, amount })
      setError(null)
    } catch (err) {
      console.error("payout save failed", err)
      setError("Could not record the payout. Check that the Firestore rule for collectorPayouts is published.")
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <span>Collector performance</span>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="lastMonth">Last month</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              {mayPay && (
                <div className="flex items-center gap-1">
                  <Label htmlFor="pay-rate" className="whitespace-nowrap text-xs text-muted-foreground">Pay per pickup ₦</Label>
                  <Input id="pay-rate" type="number" min={0} inputMode="numeric" className="h-9 w-24" value={rateDraft}
                    onChange={(e) => setRateDraft(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={saveRate} disabled={rateDraft === String(rate || "")}>Save</Button>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collector</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Success</TableHead>
                <TableHead>Rating</TableHead>
                {mayPay && <TableHead className="text-right">Earned</TableHead>}
                {mayPay && <TableHead className="text-right">Owed</TableHead>}
                {mayPay && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.collector.id}>
                  <TableCell>
                    <div className="font-medium">{r.collector.name}</div>
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {r.open > 0 && <span>{r.open} open</span>}
                      {r.awaiting > 0 && <Badge className="bg-amber-100 text-amber-800">{r.awaiting} to confirm</Badge>}
                      {!r.collector.active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.assigned}</TableCell>
                  <TableCell className="text-right font-medium">{r.completed}</TableCell>
                  <TableCell className="text-right">{r.failed || "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.rate == null ? "—" : (
                      <span className={r.rate >= 90 ? "text-green-700" : r.rate >= 75 ? "text-amber-700" : "text-destructive"}>{r.rate}%</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.avgRating == null ? <span className="text-muted-foreground">—</span> : (
                      <span className="inline-flex items-center gap-1 text-sm">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{r.avgRating.toFixed(1)}
                        <span className="text-xs text-muted-foreground">({r.ratingCount})</span>
                      </span>
                    )}
                  </TableCell>
                  {mayPay && <TableCell className="text-right">{rate ? naira(r.earnedPeriod) : "—"}</TableCell>}
                  {mayPay && (
                    <TableCell className="text-right">
                      <div className={r.owed > 0 ? "font-semibold" : "text-muted-foreground"}>{rate || r.owed ? naira(r.owed) : "—"}</div>
                      {r.lastPayout && (
                        <div className="text-[11px] text-muted-foreground">
                          Last paid {naira(r.lastPayout.amount)} on {new Date(r.lastPayout.paidAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                        </div>
                      )}
                    </TableCell>
                  )}
                  {mayPay && (
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => openPay(r.collector, r.owed)}>
                        <Wallet className="mr-1 h-4 w-4" /> Record payout
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No collectors yet.</p>}
          {mayPay && !rate && (
            <p className="mt-3 text-xs text-muted-foreground">Set the pay per completed pickup above to see what each collector has earned and is owed.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payout to {paying?.collector.name}</DialogTitle>
            <DialogDescription>Currently owed: {naira(paying?.owed ?? 0)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="payout-amount">Amount paid (NGN)</Label>
              <Input id="payout-amount" type="number" min={0} inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="payout-note" placeholder="e.g. Transfer for 1–15 Nov" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
            <Button onClick={savePayout}>Save payout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
