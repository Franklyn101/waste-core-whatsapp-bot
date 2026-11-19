"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FirebaseService } from "@/lib/firebase-service"
import type { Collector, CollectorPickup, PickupCollection } from "@/lib/types"

const NO_ONE = "__no_one__"

// The job being completed (or whose credit is being changed). Pass `pickup`
// for subscription visits, which are written from the full record.
export interface CreditJob {
  collection: PickupCollection | "subscriptionVisits"
  id: string
  customerName: string
  status: string
  collectorId: string | null
  collectorName: string
  creditedCollectorId?: string | null
  reportedDone?: boolean
  pickup?: CollectorPickup
}

// Who is credited (and paid) for a completed job: the collector the admin
// chose, or else the assigned collector. null = no collector.
export function creditedTo(job: { status?: string; collectorId: string | null; creditedCollectorId?: string | null }): string | null {
  if (job.creditedCollectorId !== undefined) return job.creditedCollectorId
  return job.collectorId ?? null
}

export function useCollectors(enabled = true): Collector[] {
  const [collectors, setCollectors] = useState<Collector[]>([])
  useEffect(() => {
    if (!enabled) return
    return FirebaseService.subscribeToCollectors(setCollectors)
  }, [enabled])
  return collectors
}

interface Props {
  job: CreditJob | null
  collectors: Collector[]
  onClose: () => void
  onError?: (message: string) => void
}

export function CompletionCreditDialog({ job, collectors, onClose, onError }: Props) {
  const [choice, setChoice] = useState(NO_ONE)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!job) return
    const current = job.status === "completed" ? creditedTo(job) : job.collectorId
    setChoice(current ?? NO_ONE)
  }, [job])

  if (!job) return null
  const changing = job.status === "completed"
  const assigned = collectors.find((c) => c.id === job.collectorId)
  const options = collectors.filter((c) => c.active || c.id === job.collectorId || c.id === choice)

  const save = async () => {
    setSaving(true)
    const picked = choice === NO_ONE ? null : collectors.find((c) => c.id === choice)
    const ok = await FirebaseService.completePickup(
      job.pickup ?? { collection: job.collection as PickupCollection, id: job.id, customerName: job.customerName, status: job.status },
      picked ? { id: picked.id, name: picked.name } : null,
    )
    setSaving(false)
    if (!ok) onError?.("Could not save. Please try again.")
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{changing ? "Change who did this pickup" : "Who did this pickup?"}</DialogTitle>
          <DialogDescription>
            {job.customerName ? `${job.customerName}. ` : ""}
            The collector you choose gets the completed job and the pay for it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Credit this pickup to</Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.id === job.collectorId ? " (assigned)" : ""}
                </SelectItem>
              ))}
              <SelectItem value={NO_ONE}>No collector (don&apos;t credit anyone)</SelectItem>
            </SelectContent>
          </Select>
          {assigned && !job.reportedDone && choice === assigned.id && (
            <p className="text-xs text-amber-700">
              {assigned.name} hasn&apos;t reported this pickup as done. If someone else did it, choose them instead.
            </p>
          )}
          {job.collectorId && choice !== job.collectorId && (
            <p className="text-xs text-muted-foreground">
              {assigned?.name || job.collectorName || "The assigned collector"} won&apos;t be credited or paid for this pickup.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : changing ? "Save" : "Mark completed"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
