"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  Calendar,
  ClipboardList,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"
import { FirebaseService } from "@/lib/firebase-service"
import type { Collector, CollectorInput, CollectorPickup, PickupStatus } from "@/lib/types"

const UNASSIGNED = "__unassigned__"
const ALL = "__all__"

const STATUS_OPTIONS: { value: PickupStatus; label: string }[] = [
  { value: "pending",    label: "Pending" },
  { value: "assigned",   label: "Assigned" },
  { value: "completed",  label: "Completed" },
  { value: "incomplete", label: "Incomplete" },
  { value: "cancelled",  label: "Cancelled" },
]

const STATUS_BADGE: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800",
  assigned:   "bg-blue-100 text-blue-800",
  confirmed:  "bg-blue-100 text-blue-800",
  completed:  "bg-green-100 text-green-800",
  incomplete: "bg-orange-100 text-orange-800",
  cancelled:  "bg-red-100 text-red-800",
}

const EMPTY_FORM: CollectorInput = { name: "", phone: "", area: "", active: true }

// WhatsApp needs the international number without "+": 08012345678 and
// +234 801 234 5678 both become 2348012345678.
function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  return digits.length === 11 && digits.startsWith("0") ? `234${digits.slice(1)}` : digits
}

function collectorMessage(pickup: CollectorPickup, collector: Collector): string {
  const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickup.address)}`
  return [
    `Hello ${collector.name}, you have a new WasteCore pickup.`,
    "",
    `Date: ${pickup.pickupDate || "N/A"}`,
    `Customer: ${pickup.customerName || "N/A"}`,
    `Phone: ${pickup.customerPhone || "N/A"}`,
    `Address: ${pickup.address || "N/A"}`,
    ...(pickup.address ? [`Map: ${mapLink}`] : []),
    `Waste: ${pickup.wasteType || "N/A"}`,
    `Service: ${pickup.serviceType || "N/A"}`,
  ].join("\n")
}

// Click-to-chat link: opens the WhatsApp app (or WhatsApp Web) on the
// collector's chat with the pickup details already typed in.
function whatsAppLink(pickup: CollectorPickup, collector: Collector): string {
  return `https://wa.me/${toWhatsAppNumber(collector.phone)}?text=${encodeURIComponent(collectorMessage(pickup, collector))}`
}

interface CollectorsManagerProps {
  searchQuery?: string
}

export function CollectorsManager({ searchQuery = "" }: CollectorsManagerProps) {
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [pickups, setPickups] = useState<CollectorPickup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState("collectors")
  const [collectorFilter, setCollectorFilter] = useState<string>(ALL)
  const [statusFilter, setStatusFilter] = useState<string>(ALL)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Collector | null>(null)
  const [form, setForm] = useState<CollectorInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Collector | null>(null)

  useEffect(() => {
    let collectorsLoaded = false
    let pickupsLoaded = false
    const done = () => { if (collectorsLoaded && pickupsLoaded) setIsLoading(false) }
    const onError = (err: Error) => setError(err.message)

    const unsubCollectors = FirebaseService.subscribeToCollectors((list) => {
      setCollectors(list)
      collectorsLoaded = true
      done()
    }, (err) => { onError(err); collectorsLoaded = true; done() })

    const unsubPickups = FirebaseService.subscribeToCollectorPickups((list) => {
      setPickups(list)
      pickupsLoaded = true
      done()
    }, onError)

    return () => {
      unsubCollectors()
      unsubPickups()
    }
  }, [])

  const statsByCollector = useMemo(() => {
    const stats = new Map<string, { open: number; completed: number; incomplete: number }>()
    for (const p of pickups) {
      if (!p.collectorId) continue
      const s = stats.get(p.collectorId) ?? { open: 0, completed: 0, incomplete: 0 }
      if (p.status === "completed") s.completed++
      else if (p.status === "incomplete") s.incomplete++
      else if (p.status !== "cancelled") s.open++
      stats.set(p.collectorId, s)
    }
    return stats
  }, [pickups])

  const query = searchQuery.trim().toLowerCase()

  const visibleCollectors = collectors.filter((c) =>
    !query ||
    c.name.toLowerCase().includes(query) ||
    c.phone.includes(query) ||
    c.area.toLowerCase().includes(query)
  )

  const visiblePickups = pickups.filter((p) => {
    if (collectorFilter === UNASSIGNED && p.collectorId) return false
    if (collectorFilter !== ALL && collectorFilter !== UNASSIGNED && p.collectorId !== collectorFilter) return false
    if (statusFilter !== ALL && p.status !== statusFilter) return false
    if (query) {
      const haystack = `${p.customerName} ${p.address} ${p.wasteType} ${p.collectorName}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })

  const unassignedCount = pickups.filter(
    (p) => !p.collectorId && p.status !== "completed" && p.status !== "cancelled"
  ).length

  // ── Collector CRUD ────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (collector: Collector) => {
    setEditing(collector)
    setForm({ name: collector.name, phone: collector.phone, area: collector.area, active: collector.active })
    setFormError(null)
    setFormOpen(true)
  }

  const handleSave = async () => {
    const input: CollectorInput = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      area: form.area.trim(),
      active: form.active,
    }
    if (!input.name) return setFormError("Name is required.")
    if (!/^\+?\d{7,15}$/.test(input.phone.replace(/[\s-]/g, ""))) {
      return setFormError("Enter a valid phone number, e.g. +2348012345678.")
    }

    // Firestore shows the change locally right away but only resolves once the
    // server confirms, which can be slow on mobile data — so close the dialog
    // immediately and surface a failure as a banner.
    setFormOpen(false)
    const ok = editing
      ? await FirebaseService.updateCollector(editing.id, input)
      : await FirebaseService.createCollector(input)
    if (!ok) setError(`Could not save ${input.name}. Please try again.`)
  }

  const handleDelete = async () => {
    if (!deleting) return
    const ok = await FirebaseService.deleteCollector(deleting.id, pickups)
    if (!ok) setError(`Could not delete ${deleting.name}. Please try again.`)
    setDeleting(null)
  }

  const viewPickups = (collectorId: string) => {
    setCollectorFilter(collectorId)
    setStatusFilter(ALL)
    setTab("pickups")
  }

  // ── Pickup assignment ─────────────────────────────────────────────────────
  const handleAssign = async (pickup: CollectorPickup, value: string) => {
    const collector = value === UNASSIGNED ? null : collectors.find((c) => c.id === value) ?? null
    // Open WhatsApp before awaiting anything — browsers only allow new
    // windows directly from the click.
    if (collector) window.open(whatsAppLink(pickup, collector), "_blank", "noopener")
    const ok = await FirebaseService.assignPickup(pickup, collector)
    if (!ok) setError("Could not update the assignment. Please try again.")
  }

  const handleStatus = async (pickup: CollectorPickup, status: PickupStatus) => {
    const ok = await FirebaseService.updatePickupStatus(pickup, status)
    if (!ok) setError("Could not update the pickup status. Please try again.")
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="h-48 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    )
  }

  const activeCollectors = collectors.filter((c) => c.active)

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <SummaryCard label="Collectors" value={collectors.length} hint={`${activeCollectors.length} active`} />
        <SummaryCard label="Unassigned pickups" value={unassignedCount} hint="Waiting for a collector" />
        <SummaryCard
          label="Incomplete pickups"
          value={pickups.filter((p) => p.status === "incomplete").length}
          hint="Need follow-up"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="collectors">
            <Users className="w-4 h-4 mr-2" /> Collectors
          </TabsTrigger>
          <TabsTrigger value="pickups">
            <ClipboardList className="w-4 h-4 mr-2" /> Assign Pickups
          </TabsTrigger>
        </TabsList>

        {/* ── Collectors list ─────────────────────────────────────────────── */}
        <TabsContent value="collectors">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Collectors ({visibleCollectors.length})</span>
                <Button size="sm" onClick={openCreate}>
                  <UserPlus className="w-4 h-4 mr-2" /> Register collector
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Incomplete</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCollectors.map((c) => {
                    const s = statsByCollector.get(c.id) ?? { open: 0, completed: 0, incomplete: 0 }
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{c.phone}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.area ? (
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              <span className="text-sm">{c.area}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={c.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                            {c.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{s.open}</TableCell>
                        <TableCell className="text-right">{s.completed}</TableCell>
                        <TableCell className="text-right">{s.incomplete}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => viewPickups(c.id)}>
                                <ClipboardList className="w-4 h-4 mr-2" /> View pickups
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(c)}>
                                <Pencil className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(c)}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {visibleCollectors.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  {query ? "No collectors match your search." : "No collectors yet. Register your first collector."}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Pickup assignment ───────────────────────────────────────────── */}
        <TabsContent value="pickups">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span>Pickups ({visiblePickups.length})</span>
                <div className="flex flex-wrap gap-2">
                  <Select value={collectorFilter} onValueChange={setCollectorFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Collector" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All collectors</SelectItem>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {collectors.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Pickup Date</TableHead>
                    <TableHead>Collector</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePickups.map((p) => {
                    // Keep a deleted/unknown collector visible instead of
                    // silently showing "Unassigned".
                    const known = !p.collectorId || collectors.some((c) => c.id === p.collectorId)
                    const assignedCollector = collectors.find((c) => c.id === p.collectorId)
                    return (
                      <TableRow key={`${p.collection}_${p.id}`}>
                        <TableCell className="font-medium">{p.customerName || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-gray-400" />
                            <span className="text-sm max-w-xs truncate">{p.address || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{p.serviceType || (p.collection === "instantPickups" ? "instant" : "weekly")}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{p.pickupDate || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={p.collectorId ?? UNASSIGNED}
                            onValueChange={(v) => handleAssign(p, v)}
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue placeholder="Assign collector" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                              {!known && p.collectorId && (
                                <SelectItem value={p.collectorId} disabled>
                                  {p.collectorName || "Removed collector"}
                                </SelectItem>
                              )}
                              {collectors
                                .filter((c) => c.active || c.id === p.collectorId)
                                .map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}{c.area ? ` · ${c.area}` : ""}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          {assignedCollector && (
                            <a
                              href={whatsAppLink(p, assignedCollector)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs text-green-700 hover:underline"
                            >
                              <MessageCircle className="w-3 h-3" /> Send on WhatsApp
                            </a>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select value={p.status} onValueChange={(v) => handleStatus(p, v as PickupStatus)}>
                            <SelectTrigger className="w-36">
                              <SelectValue>
                                <Badge className={STATUS_BADGE[p.status] ?? STATUS_BADGE.pending}>{p.status}</Badge>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {visiblePickups.length === 0 && (
                <div className="text-center py-8 text-gray-400">No pickups match these filters.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create / edit dialog ──────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit collector" : "Register collector"}</DialogTitle>
            <DialogDescription>
              Assigning a pickup opens WhatsApp with the pickup details ready to send to this number. Customers are never sent the collector&apos;s name.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); handleSave() }}
          >
            <div className="space-y-2">
              <Label htmlFor="collector-name">Full name</Label>
              <Input
                id="collector-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Musa Ibrahim"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collector-phone">WhatsApp number</Label>
              <Input
                id="collector-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+2348012345678"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collector-area">Area / zone</Label>
              <Input
                id="collector-area"
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="e.g. Lekki Phase 1"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="collector-active">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive collectors can&apos;t be given new pickups.</p>
              </div>
              <Switch
                id="collector-active"
                checked={form.active}
                onCheckedChange={(checked) => setForm({ ...form, active: checked })}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit">{editing ? "Save changes" : "Register"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ───────────────────────────────────────────── */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the collector.
              {deleting && (statsByCollector.get(deleting.id)?.open ?? 0) > 0 &&
                ` Their ${statsByCollector.get(deleting.id)!.open} open pickup(s) will go back to Unassigned.`}
              {" "}To keep their history, mark them inactive instead.
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

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card className="gap-1 py-3 md:gap-6 md:py-6">
      <CardHeader className="px-3 pb-0 md:px-6 md:pb-2">
        <CardTitle className="text-xs md:text-sm font-medium leading-tight text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <div className="text-xl md:text-2xl font-bold">{value}</div>
        <p className="hidden md:block text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  )
}
