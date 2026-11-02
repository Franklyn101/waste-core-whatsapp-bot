"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { METHOD_LABELS, loadRevenue, revenueCsv, type RevenueData, type RevenueEntry } from "@/lib/revenue"
import { logActivity } from "@/lib/activity"

type Preset = "today" | "week" | "month" | "lastMonth" | "year" | "custom"

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom" },
]

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`

function todayLagos(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number)
  switch (preset) {
    case "today": return { from: today, to: today }
    case "week": {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
      return { from: shiftDays(today, -dow), to: today }
    }
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today }
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
      return { from: first, to: last }
    }
    case "year": return { from: `${y}-01-01`, to: today }
    default: return { from: `${today.slice(0, 7)}-01`, to: today }
  }
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
}

function sumBy(entries: RevenueEntry[], key: (e: RevenueEntry) => string) {
  const map = new Map<string, { count: number; amount: number }>()
  for (const e of entries) {
    const k = key(e)
    const cur = map.get(k) ?? { count: 0, amount: 0 }
    cur.count++
    cur.amount += e.amount
    map.set(k, cur)
  }
  return [...map.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.amount - a.amount)
}

export function RevenueReports() {
  const [data, setData] = useState<RevenueData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<Preset>("month")
  const today = todayLagos()
  const [range, setRange] = useState(() => presetRange("month", today))

  const refresh = useCallback(() => {
    setLoading(true)
    loadRevenue()
      .then((d) => { setData(d); setError(null) })
      .catch((err) => { console.error("revenue load failed", err); setError("Could not load revenue. Please try again.") })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const choosePreset = (p: Preset) => {
    setPreset(p)
    if (p !== "custom") setRange(presetRange(p, today))
  }

  const inRange = useMemo(
    () => (data?.entries ?? []).filter((e) => e.date >= range.from && e.date <= range.to),
    [data, range]
  )
  const total = inRange.reduce((s, e) => s + e.amount, 0)
  const byService = sumBy(inRange, (e) => e.service)
  const byMethod = sumBy(inRange, (e) => METHOD_LABELS[e.method] ?? e.method)
  // Daily for up to two months, otherwise monthly.
  const daily = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 <= 62
  const overTime = sumBy(inRange, (e) => (daily ? e.date : e.date.slice(0, 7))).sort((a, b) => a.label.localeCompare(b.label))
  const maxPeriod = Math.max(1, ...overTime.map((p) => p.amount))

  const downloadCsv = () => {
    const blob = new Blob([revenueCsv(inRange)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `wastecore-revenue-${range.from}-to-${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
    logActivity("Downloaded revenue report", { from: range.from, to: range.to, count: inRange.length })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => choosePreset(p.id)}>
              {p.label}
            </Button>
          ))}
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={range.from} aria-label="From"
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })) }} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" className="w-40" value={range.to} aria-label="To"
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })) }} />
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={downloadCsv} disabled={!inRange.length}>
              <Download className="mr-2 h-4 w-4" /> Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Stat label="Revenue" value={naira(total)} hint={`${prettyDate(range.from)} – ${prettyDate(range.to)}`} />
        <Stat label="Payments" value={String(inRange.length)} hint={inRange.length ? `Average ${naira(total / inRange.length)}` : "None yet"} />
        <Stat label="Paystack" value={naira(inRange.filter((e) => e.method === "paystack").reduce((s, e) => s + e.amount, 0))} hint="Paid online" />
        <Stat
          label="Awaiting verification"
          value={naira(data?.awaiting.amount ?? 0)}
          hint={`${data?.awaiting.count ?? 0} receipt(s) not checked yet (all dates)`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownCard title="By service" rows={byService} total={total} />
        <BreakdownCard title="By payment method" rows={byMethod} total={total} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{daily ? "Per day" : "Per month"}</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {overTime.length === 0 && <p className="text-sm text-muted-foreground">No payments in this period.</p>}
          {overTime.map((p) => (
            <div key={p.label} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">
                {daily ? new Date(`${p.label}T00:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "short" })
                  : new Date(`${p.label}-01T00:00:00`).toLocaleDateString("en-NG", { month: "short", year: "numeric" })}
              </span>
              <div className="h-4 flex-1 rounded bg-muted">
                <div className="h-4 rounded bg-primary" style={{ width: `${(p.amount / maxPeriod) * 100}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right font-medium">{naira(p.amount)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments ({inRange.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inRange.slice(0, 200).map((e, i) => (
                <TableRow key={`${e.date}-${e.reference}-${i}`}>
                  <TableCell className="whitespace-nowrap text-sm">{prettyDate(e.date)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{e.customerName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{e.customerPhone}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{e.service}</div>
                    {e.details && <div className="text-xs text-muted-foreground">{e.details}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{METHOD_LABELS[e.method] ?? e.method}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{naira(e.amount)}</TableCell>
                  <TableCell>
                    {e.receiptUrl ? (
                      <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 hover:underline">
                        {e.receiptNumber || "PDF"}
                      </a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {inRange.length > 200 && (
            <p className="mt-3 text-xs text-muted-foreground">Showing the latest 200. Download the CSV for all {inRange.length}.</p>
          )}
          {!loading && inRange.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No payments in this period.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="gap-1 py-3 md:py-5">
      <CardHeader className="px-3 pb-0 md:px-6">
        <CardTitle className="text-xs font-medium text-muted-foreground md:text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <div className="text-xl font-bold md:text-2xl">{value}</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground md:text-xs">{hint}</p>
      </CardContent>
    </Card>
  )
}

function BreakdownCard({ title, rows, total }: { title: string; rows: { label: string; count: number; amount: number }[]; total: number }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No payments in this period.</p>}
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-sm">
              <span>{r.label} <span className="text-muted-foreground">({r.count})</span></span>
              <span className="font-medium">{naira(r.amount)}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-muted">
              <div className="h-2 rounded bg-primary" style={{ width: `${total ? (r.amount / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
