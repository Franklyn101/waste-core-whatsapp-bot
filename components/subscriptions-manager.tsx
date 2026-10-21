"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertCircle,
  CalendarClock,
  MapPin,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  Play,
  Trash2,
  UserPlus,
} from "lucide-react"
import { FirebaseService } from "@/lib/firebase-service"
import type { SubscriberInput, SubscriberStatus, SubscriptionRow } from "@/lib/types"
import {
  SUBSCRIPTION_PLANS,
  TIME_WINDOWS,
  WASTE_TYPES,
  WEEK_DAYS,
  findPlan,
  nextPickupDate,
  planPriceLabel,
  sortDays,
  type SubscriptionKind,
} from "@/lib/subscriptions"
import { cn } from "@/lib/utils"

const ALL = "__all__"

const STATUS_BADGE: Record<string, string> = {
  active:    "bg-green-100 text-green-800",
  paused:    "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800",
  pending:   "bg-yellow-100 text-yellow-800",
  assigned:  "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
}

const EMPTY_FORM: SubscriberInput = {
  customerName: "",
  customerPhone: "",
  address: "",
  wasteType: "General",
  planId: "weekly_1",
  pickupDays: [],
  timeWindow: "morning",
  startDate: "",
  status: "active",
  notes: "",
  linkedRequestId: null,
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" }) : "—"
}

interface SubscriptionsManagerProps {
  searchQuery?: string
}

export function SubscriptionsManager({ searchQuery = "" }: SubscriptionsManagerProps) {
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<SubscriptionKind>("weekly")
  const [statusFilter, setStatusFilter] = useState<string>(ALL)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SubscriberInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SubscriptionRow | null>(null)

  useEffect(() => {
    return FirebaseService.subscribeToSubscriptions(
      (list) => { setRows(list); setIsLoading(false) },
      (err) => { setError(err.message); setIsLoading(false) }
    )
  }, [])

  const query = searchQuery.trim().toLowerCase()
  const todayName = WEEK_DAYS[(new Date().getDay() + 6) % 7]

  const kindRows = rows.filter((r) => r.kind === kind)
  const visibleRows = kindRows.filter((r) => {
    if (statusFilter !== ALL && r.status !== statusFilter) return false
    if (!query) return true
    return `${r.customerName} ${r.customerPhone} ${r.address} ${r.wasteType}`.toLowerCase().includes(query)
  })

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "active")
    return {
      weekly: active.filter((r) => r.kind === "weekly").length,
      monthly: active.filter((r) => r.kind === "monthly").length,
      today: active.filter((r) => r.pickupDays.includes(todayName)).length,
      unscheduled: active.filter((r) => r.source === "whatsapp").length,
    }
  }, [rows, todayName])

  // ── Form ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, planId: kind === "weekly" ? "weekly_1" : "starter", startDate: todayIso() })
    setFormError(null)
    setFormOpen(true)
  }

  // Admin rows are edited in place; a WhatsApp booking is copied into a new
  // subscriber (linked to the booking) so a schedule can be added.
  const openEdit = (row: SubscriptionRow) => {
    setEditingId(row.source === "admin" ? row.id : null)
    setForm({
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      address: row.address,
      wasteType: row.wasteType || "General",
      planId: row.planId,
      pickupDays: row.pickupDays,
      timeWindow: row.timeWindow || "morning",
      startDate: row.startDate || todayIso(),
      status: row.status,
      notes: row.notes,
      linkedRequestId: row.source === "whatsapp" ? row.id : row.linkedRequestId ?? null,
    })
    setFormError(null)
    setFormOpen(true)
  }

  const plan = findPlan(form.planId)

  const setPlan = (planId: string) => {
    const next = findPlan(planId)
    setFormError(null)
    setForm((f) => ({
      ...f,
      planId,
      // Daily plans cover every day; otherwise keep what fits the new plan.
      pickupDays: next?.pickupsPerWeek === 7
        ? [...WEEK_DAYS]
        : f.pickupDays.slice(0, next?.pickupsPerWeek ?? f.pickupDays.length),
    }))
  }

  const toggleDay = (day: string) => {
    setFormError(null)
    setForm((f) => {
      if (f.pickupDays.includes(day)) return { ...f, pickupDays: f.pickupDays.filter((d) => d !== day) }
      if (plan && f.pickupDays.length >= plan.pickupsPerWeek) return f
      return { ...f, pickupDays: sortDays([...f.pickupDays, day]) }
    })
  }

  const handleSave = async () => {
    const input: SubscriberInput = {
      ...form,
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      address: form.address.trim(),
      wasteType: form.wasteType.trim(),
      notes: form.notes.trim(),
      pickupDays: sortDays(form.pickupDays),
    }
    if (!input.customerName) return setFormError("Customer name is required.")
    if (!/^\+?\d{7,15}$/.test(input.customerPhone.replace(/[\s-]/g, ""))) {
      return setFormError("Enter a valid phone number, e.g. +2348012345678.")
    }
    if (!input.address) return setFormError("Pickup address is required.")
    if (!input.wasteType) return setFormError("Choose the type of waste.")
    if (!plan) return setFormError("Choose a plan.")
    if (input.pickupDays.length !== plan.pickupsPerWeek) {
      return setFormError(`Pick exactly ${plan.pickupsPerWeek} pickup day${plan.pickupsPerWeek > 1 ? "s" : ""} for this plan.`)
    }
    if (!input.startDate) return setFormError("Choose a start date.")

    // Firestore applies the change locally right away; close immediately and
    // report a failure as a banner (slow mobile data can delay the server).
    setFormOpen(false)
    const ok = editingId
      ? await FirebaseService.updateSubscriber(editingId, input)
      : await FirebaseService.createSubscriber(input)
    if (!ok) setError(`Could not save ${input.customerName}. Please try again.`)
  }

  const setStatus = async (row: SubscriptionRow, status: SubscriberStatus) => {
    const { id, source, collection, kind: _k, requestStatus, createdAt, ...input } = row
    const ok = await FirebaseService.updateSubscriber(id, { ...input, status })
    if (!ok) setError("Could not update the status. Please try again.")
  }

  const handleDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    const ok = await FirebaseService.deleteSubscriber(target.id)
    if (!ok) setError(`Could not delete ${target.customerName}. Please try again.`)
  }

  // Retired plans stay selectable only for a record already on them.
  const plansForKind = (k: SubscriptionKind) =>
    SUBSCRIPTION_PLANS.filter((p) => p.kind === k && (!p.legacy || p.id === form.planId))
  const formKind = plan?.kind ?? "weekly"
  const wasteOptions = WASTE_TYPES.includes(form.wasteType) || !form.wasteType
    ? WASTE_TYPES
    : [form.wasteType, ...WASTE_TYPES]

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="h-48 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <SummaryCard label="Active weekly" value={stats.weekly} />
        <SummaryCard label="Active monthly" value={stats.monthly} />
        <SummaryCard label={`Pickups today (${todayName})`} value={stats.today} />
        <SummaryCard label="Need a schedule" value={stats.unscheduled} hint="WhatsApp bookings" />
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={kind} onValueChange={(v) => setKind(v as SubscriptionKind)}>
              <TabsList>
                <TabsTrigger value="weekly">
                  Weekly ({rows.filter((r) => r.kind === "weekly").length})
                </TabsTrigger>
                <TabsTrigger value="monthly">
                  Monthly ({rows.filter((r) => r.kind === "monthly").length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-9" onClick={openCreate}>
                <UserPlus className="mr-2 h-4 w-4" /> Register subscriber
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Waste</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Next pickup</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const rowPlan = findPlan(r.planId)
                const timeLabel = TIME_WINDOWS.find((t) => t.id === r.timeWindow)?.label.split(" (")[0]
                const next = r.status === "active" ? nextPickupDate(r.pickupDays, r.startDate) : null
                return (
                  <TableRow key={`${r.collection}_${r.id}`}>
                    <TableCell>
                      <div className="font-medium">{r.customerName || "—"}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" /> {r.customerPhone || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-56 items-center gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0 text-gray-400" />
                        <span className="truncate text-sm">{r.address || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.wasteType ? <Badge variant="outline">{r.wasteType}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{rowPlan?.label ?? r.planId}</div>
                      {rowPlan && <div className="text-xs text-muted-foreground">{planPriceLabel(rowPlan)}</div>}
                    </TableCell>
                    <TableCell>
                      {r.pickupDays.length ? (
                        <div>
                          <div className="flex flex-wrap gap-1">
                            {r.pickupDays.length === 7 ? (
                              <Badge variant="secondary">Daily</Badge>
                            ) : (
                              r.pickupDays.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)
                            )}
                          </div>
                          {timeLabel && <div className="mt-1 text-xs text-muted-foreground">{timeLabel}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not set{r.startDate ? ` · starts ${r.startDate}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(next)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge className={STATUS_BADGE[r.requestStatus ?? r.status] ?? STATUS_BADGE.active}>
                          {r.source === "whatsapp" ? r.requestStatus : r.status}
                        </Badge>
                        {r.source === "whatsapp" && (
                          <span className="text-[11px] text-muted-foreground">via WhatsApp</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.source === "whatsapp" ? (
                        <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                          <CalendarClock className="mr-1 h-4 w-4" /> Set schedule
                        </Button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label={`Actions for ${r.customerName}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            {r.status === "active" ? (
                              <DropdownMenuItem onClick={() => setStatus(r, "paused")}>
                                <Pause className="mr-2 h-4 w-4" /> Pause
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setStatus(r, "active")}>
                                <Play className="mr-2 h-4 w-4" /> Resume
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(r)}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {visibleRows.length === 0 && (
            <div className="py-8 text-center text-gray-400">
              {kindRows.length === 0
                ? `No ${kind} subscribers yet. Register one, or they appear here when customers subscribe on WhatsApp.`
                : "No subscribers match these filters."}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Register / edit dialog ────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit subscriber" : form.linkedRequestId ? "Set pickup schedule" : "Register subscriber"}
            </DialogTitle>
            <DialogDescription>
              {form.linkedRequestId && !editingId
                ? "Add a schedule for this WhatsApp subscription. It will then be managed here."
                : "Customer details, type of waste and pickup schedule."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSave() }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sub-name">Full name</Label>
                <Input id="sub-name" value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-phone">WhatsApp number</Label>
                <Input id="sub-phone" inputMode="tel" placeholder="+2348012345678" value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub-address">Pickup address</Label>
              <Textarea id="sub-address" rows={2} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type of waste</Label>
                <Select value={form.wasteType} onValueChange={(v) => setForm({ ...form, wasteType: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose waste type" /></SelectTrigger>
                  <SelectContent>
                    {wasteOptions.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subscription</Label>
                <Select
                  value={formKind}
                  onValueChange={(v) => setPlan(v === "weekly" ? "weekly_1" : "starter")}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly pickup</SelectItem>
                    <SelectItem value="monthly">Monthly business plan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Plan</Label>
              <div className="grid grid-cols-3 gap-2">
                {plansForKind(formKind).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs transition-colors",
                      form.planId === p.id ? "border-primary bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="text-muted-foreground">{planPriceLabel(p)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Pickup days{" "}
                {plan && (
                  <span className="font-normal text-muted-foreground">
                    ({form.pickupDays.length}/{plan.pickupsPerWeek} chosen)
                  </span>
                )}
              </Label>
              <div className="grid grid-cols-7 gap-1">
                {WEEK_DAYS.map((d) => {
                  const selected = form.pickupDays.includes(d)
                  const full = !!plan && form.pickupDays.length >= plan.pickupsPerWeek
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      disabled={!selected && full}
                      aria-pressed={selected}
                      className={cn(
                        "h-10 rounded-md border text-xs font-medium transition-colors",
                        selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        !selected && full && "opacity-40"
                      )}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Pickup time</Label>
                <Select value={form.timeWindow} onValueChange={(v) => setForm({ ...form, timeWindow: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIME_WINDOWS.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-start">Start date</Label>
                <Input id="sub-start" type="date" value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
            </div>

            {editingId && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as SubscriberStatus })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sub-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="sub-notes" rows={2} placeholder="e.g. Gate code, call before arriving"
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit">{editingId ? "Save changes" : "Save subscriber"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.customerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the subscriber and their schedule. To stop pickups for now, pause them instead.
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

function SummaryCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="gap-1 py-3 md:gap-2 md:py-5">
      <CardHeader className="px-3 pb-0 md:px-6">
        <CardTitle className="text-xs font-medium leading-tight text-muted-foreground md:text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <div className="text-xl font-bold md:text-2xl">{value}</div>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground md:text-xs">{hint}</p>}
      </CardContent>
    </Card>
  )
}
