import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  type QuerySnapshot,
  type DocumentData,
  Timestamp,
} from "firebase/firestore"
import { db } from "./firebase"
import type {
  WasteRequest,
  WasteBagOrder,
  UpgradeRequest,
  SupportTicket,
  DashboardStats,
  Collector,
  CollectorInput,
  CollectorPickup,
  PickupCollection,
  PickupStatus,
} from "./types"

// ======================
// SAFE DATE PARSER
// ======================
// Missing/invalid dates fall back to epoch so they sort last and never
// count as "today".
function parseDate(value: any): Date {
  let date: Date | null = null
  if (value instanceof Timestamp) date = value.toDate()
  else if (typeof value === "string") date = new Date(value)
  else if (value instanceof Date) date = value
  return date && !isNaN(date.getTime()) ? date : new Date(0)
}

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

// ======================
// NORMALIZERS
// ======================
function normalizeRequest(data: any, id: string): WasteRequest {
  const createdAt = parseDate(data.createdAt)
  const updatedAt = parseDate(data.updatedAt || data.createdAt)
  return {
    id,
    customerName:      data.customerName ?? "",
    customerPhone:     data.customerPhone ?? "",
    address:           data.address ?? "",
    wasteType:         data.wasteType ?? "",
    pickupDate:        data.pickupDate ?? "",
    paymentReceiptUrl: data.paymentReceiptUrl ?? "",
    status:            data.status ?? "pending",
    serviceType:       data.serviceType ?? "instant",
    createdAt,
    updatedAt,
  }
}

function normalizeWasteBagOrder(data: any, id: string): WasteBagOrder {
  const createdAt = parseDate(data.createdAt)
  const updatedAt = parseDate(data.updatedAt || data.createdAt)
  return {
    id,
    customerName:      data.customerName ?? "",
    customerPhone:     data.customerPhone ?? "",
    deliveryAddress:   data.deliveryAddress ?? data.address ?? "",
    bagSize:           data.bagSize ?? "small",
    quantity:          data.quantity ?? 1,
    totalAmount:       data.totalAmount ?? 0,
    paymentReceiptUrl: data.paymentReceiptUrl ?? "",
    status:            data.status ?? "pending",
    serviceType:       "wasteBags",
    createdAt,
    updatedAt,
  }
}

function normalizeUpgradeRequest(data: any, id: string): UpgradeRequest {
  const createdAt = parseDate(data.createdAt)
  const updatedAt = parseDate(data.updatedAt || data.createdAt)
  let plan = data.plan ?? ""
  if (!plan && typeof data.serviceType === "string") {
    plan = data.serviceType.replace("upgrade_", "")
  }
  return {
    id,
    customerName:      data.customerName ?? "",
    customerPhone:     data.customerPhone ?? "",
    address:           data.address ?? "",
    plan:              plan || "basic",
    serviceType:       data.serviceType ?? `upgrade_${plan}`,
    startDate:         data.startDate ?? "",
    paymentReceiptUrl: data.paymentReceiptUrl ?? "",
    status:            data.status ?? "pending",
    createdAt,
    updatedAt,
  }
}

function normalizeSupportTicket(data: any, id: string): SupportTicket {
  const createdAt = parseDate(data.createdAt)
  const updatedAt = parseDate(data.updatedAt || data.createdAt)
  return {
    id,
    ticketId:      data.ticketId ?? id,
    customerName:  data.customerName ?? "",
    customerPhone: data.customerPhone ?? "",
    category:      data.category ?? "",
    message:       data.message ?? "",
    contactTime:   data.contactTime ?? "",
    status:        data.status ?? "open",
    createdAt,
    updatedAt,
  }
}

function normalizeCollector(data: any, id: string): Collector {
  return {
    id,
    name:      data.name ?? "",
    phone:     data.phone ?? "",
    area:      data.area ?? "",
    active:    data.active ?? true,
    createdAt: parseDate(data.createdAt),
    updatedAt: parseDate(data.updatedAt || data.createdAt),
  }
}

function normalizeCollectorPickup(data: any, id: string, col: PickupCollection): CollectorPickup {
  return {
    id,
    collection:    col,
    customerName:  data.customerName ?? "",
    customerPhone: (data.customerPhone ?? "").replace(/^whatsapp:/i, ""),
    address:       data.address ?? "",
    wasteType:     data.wasteType ?? "",
    pickupDate:    data.pickupDate ?? "",
    serviceType:   data.serviceLabel ?? data.serviceType ?? "",
    status:        data.status ?? "pending",
    collectorId:   data.collectorId ?? null,
    collectorName: data.collectorName ?? "",
    createdAt:     parseDate(data.createdAt),
  }
}

const PICKUP_COLLECTIONS: PickupCollection[] = ["instantPickups", "pickupRequests"]

// ======================
// CLIENT-SIDE SORT — newest first, then cap to limitCount.
// The limit is applied AFTER sorting: a Firestore limit() without orderBy
// returns an arbitrary subset (by doc ID), which can drop the newest docs.
// ======================
function sortByCreatedAt<T extends { createdAt: Date }>(items: T[], limitCount?: number): T[] {
  const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return limitCount ? sorted.slice(0, limitCount) : sorted
}

// ======================
// FIREBASE SERVICE
// NOTE: Queries use NO orderBy — sorted client-side instead, so docs with
// missing or mixed-type createdAt values are still returned.
// ======================
export class FirebaseService {

  // ── DASHBOARD STATS ───────────────────────────────────────────────────────
  static subscribeToDashboardStats(
    callback: (stats: DashboardStats) => void
  ): () => void {
    // Pickups come from both instant and weekly collections.
    const byCollection: Record<string, WasteRequest[]> = {
      instantPickups: [],
      pickupRequests: [],
    }
    const loaded = new Set<string>()

    const emit = () => {
      if (loaded.size < Object.keys(byCollection).length) return
      const requests = Object.values(byCollection).flat()
      const today = startOfToday()
      callback({
        totalRequests:     requests.length,
        pendingRequests:   requests.filter((r) => r.status === "pending").length,
        completedRequests: requests.filter((r) => r.status === "completed" && r.updatedAt >= today).length,
        todayRequests:     requests.filter((r) => r.createdAt >= today).length,
      })
    }

    const unsubs = Object.keys(byCollection).map((col) =>
      onSnapshot(
        collection(db, col),
        (snapshot: QuerySnapshot<DocumentData>) => {
          byCollection[col] = snapshot.docs.map((d) => normalizeRequest(d.data(), d.id))
          loaded.add(col)
          emit()
        },
        (err) => {
          console.error(`${col} stats error:`, err)
          loaded.add(col)
          emit()
        }
      )
    )

    // Recompute every minute so "today" counts reset at midnight even when
    // no new Firestore changes arrive.
    const timer = setInterval(emit, 60_000)

    return () => {
      clearInterval(timer)
      unsubs.forEach((u) => u())
    }
  }

  // ── PICKUP REQUESTS ───────────────────────────────────────────────────────
  static subscribeToPickupRequests(
    callback: (requests: WasteRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = collection(db, "pickupRequests")
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeRequest(d.data(), d.id)), limitCount)),
      (err) => { console.error("pickupRequests error:", err); onError?.(err) }
    )
  }

  // ── INSTANT PICKUPS ───────────────────────────────────────────────────────
  static subscribeToInstantPickups(
    callback: (requests: WasteRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = collection(db, "instantPickups")
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeRequest(d.data(), d.id)), limitCount)),
      (err) => { console.error("instantPickups error:", err); onError?.(err) }
    )
  }

  // ── WASTE BAG ORDERS ──────────────────────────────────────────────────────
  static subscribeToWasteBagOrders(
    callback: (orders: WasteBagOrder[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = collection(db, "wasteBagOrders")
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeWasteBagOrder(d.data(), d.id)), limitCount)),
      (err) => { console.error("wasteBagOrders error:", err); onError?.(err) }
    )
  }

  // ── UPGRADE REQUESTS ──────────────────────────────────────────────────────
  static subscribeToUpgradeRequests(
    callback: (requests: UpgradeRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = collection(db, "upgradeRequests")
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeUpgradeRequest(d.data(), d.id)), limitCount)),
      (err) => { console.error("upgradeRequests error:", err); onError?.(err) }
    )
  }

  // ── SUPPORT TICKETS ───────────────────────────────────────────────────────
  static subscribeToSupportTickets(
    callback: (tickets: SupportTicket[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = collection(db, "supportTickets")
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeSupportTicket(d.data(), d.id)), limitCount)),
      (err) => { console.error("supportTickets error:", err); onError?.(err) }
    )
  }

  // ── STATUS UPDATES ────────────────────────────────────────────────────────
  static async updateRequestStatus(requestId: string, status: string): Promise<boolean> {
    try {
      await updateDoc(doc(db, "pickupRequests", requestId), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("pickupRequests update failed", err); return false }
  }

  static async updateInstantPickupStatus(requestId: string, status: string): Promise<boolean> {
    try {
      await updateDoc(doc(db, "instantPickups", requestId), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("instantPickups update failed", err); return false }
  }

  static async updateWasteBagOrderStatus(orderId: string, status: string): Promise<boolean> {
    try {
      await updateDoc(doc(db, "wasteBagOrders", orderId), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("wasteBagOrders update failed", err); return false }
  }

  static async updateUpgradeRequestStatus(requestId: string, status: string): Promise<boolean> {
    try {
      await updateDoc(doc(db, "upgradeRequests", requestId), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("upgradeRequests update failed", err); return false }
  }

  static async updateSupportTicketStatus(ticketId: string, status: string): Promise<boolean> {
    try {
      await updateDoc(doc(db, "supportTickets", ticketId), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("supportTickets update failed", err); return false }
  }

  // ── ONE-TIME FETCHES ──────────────────────────────────────────────────────
  static async getPickupRequests(limitCount = 50): Promise<WasteRequest[]> {
    const snap = await getDocs(collection(db, "pickupRequests"))
    return sortByCreatedAt(snap.docs.map((d) => normalizeRequest(d.data(), d.id)), limitCount)
  }

  static async getInstantPickups(limitCount = 50): Promise<WasteRequest[]> {
    const snap = await getDocs(collection(db, "instantPickups"))
    return sortByCreatedAt(snap.docs.map((d) => normalizeRequest(d.data(), d.id)), limitCount)
  }

  static async getWasteBagOrders(limitCount = 50): Promise<WasteBagOrder[]> {
    const snap = await getDocs(collection(db, "wasteBagOrders"))
    return sortByCreatedAt(snap.docs.map((d) => normalizeWasteBagOrder(d.data(), d.id)), limitCount)
  }

  static async getUpgradeRequests(limitCount = 50): Promise<UpgradeRequest[]> {
    const snap = await getDocs(collection(db, "upgradeRequests"))
    return sortByCreatedAt(snap.docs.map((d) => normalizeUpgradeRequest(d.data(), d.id)), limitCount)
  }

  static async getSupportTickets(limitCount = 50): Promise<SupportTicket[]> {
    const snap = await getDocs(collection(db, "supportTickets"))
    return sortByCreatedAt(snap.docs.map((d) => normalizeSupportTicket(d.data(), d.id)), limitCount)
  }

  // ── COLLECTORS ────────────────────────────────────────────────────────────
  static subscribeToCollectors(
    callback: (collectors: Collector[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    return onSnapshot(
      collection(db, "collectors"),
      (snapshot) => callback(
        snapshot.docs
          .map((d) => normalizeCollector(d.data(), d.id))
          .sort((a, b) => a.name.localeCompare(b.name))
      ),
      (err) => { console.error("collectors error:", err); onError?.(err) }
    )
  }

  static async createCollector(input: CollectorInput): Promise<boolean> {
    try {
      const now = new Date().toISOString()
      await addDoc(collection(db, "collectors"), { ...input, createdAt: now, updatedAt: now })
      return true
    } catch (err) { console.error("collector create failed", err); return false }
  }

  static async updateCollector(collectorId: string, input: CollectorInput): Promise<boolean> {
    try {
      await updateDoc(doc(db, "collectors", collectorId), { ...input, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("collector update failed", err); return false }
  }

  // Deletes the collector and returns their unfinished pickups to the
  // unassigned pool so no job is left pointing at a missing collector.
  static async deleteCollector(collectorId: string, pickups: CollectorPickup[]): Promise<boolean> {
    try {
      const batch = writeBatch(db)
      const now = new Date().toISOString()
      pickups
        .filter((p) => p.collectorId === collectorId)
        .forEach((p) => {
          const unfinished = p.status !== "completed" && p.status !== "cancelled"
          batch.update(doc(db, p.collection, p.id), {
            collectorId: null,
            collectorName: unfinished ? "" : p.collectorName,
            ...(unfinished ? { status: "pending" } : {}),
            updatedAt: now,
          })
        })
      batch.delete(doc(db, "collectors", collectorId))
      await batch.commit()
      return true
    } catch (err) { console.error("collector delete failed", err); return false }
  }

  // ── COLLECTOR PICKUPS (instant + weekly) ──────────────────────────────────
  static subscribeToCollectorPickups(
    callback: (pickups: CollectorPickup[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const byCollection: Partial<Record<PickupCollection, CollectorPickup[]>> = {}
    const emit = () => {
      if (Object.keys(byCollection).length < PICKUP_COLLECTIONS.length) return
      callback(sortByCreatedAt(Object.values(byCollection).flat() as CollectorPickup[]))
    }
    const unsubs = PICKUP_COLLECTIONS.map((col) =>
      onSnapshot(
        collection(db, col),
        (snapshot) => {
          byCollection[col] = snapshot.docs.map((d) => normalizeCollectorPickup(d.data(), d.id, col))
          emit()
        },
        (err) => {
          console.error(`${col} error:`, err)
          byCollection[col] = []
          emit()
          onError?.(err)
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }

  // Assigning moves a pending pickup to "assigned"; unassigning returns an
  // unfinished pickup to "pending". The collector's name is stored for the
  // admin only — the customer notification never includes it.
  static async assignPickup(pickup: CollectorPickup, collector: Collector | null): Promise<boolean> {
    try {
      const update: Record<string, unknown> = {
        collectorId: collector?.id ?? null,
        collectorName: collector?.name ?? "",
        updatedAt: new Date().toISOString(),
      }
      if (collector && pickup.status === "pending") {
        update.status = "assigned"
        update.assignedAt = update.updatedAt
      }
      if (!collector && pickup.status === "assigned") update.status = "pending"
      await updateDoc(doc(db, pickup.collection, pickup.id), update)
      return true
    } catch (err) { console.error("pickup assign failed", err); return false }
  }

  static async updatePickupStatus(pickup: CollectorPickup, status: PickupStatus): Promise<boolean> {
    try {
      await updateDoc(doc(db, pickup.collection, pickup.id), { status, updatedAt: new Date().toISOString() })
      return true
    } catch (err) { console.error("pickup status update failed", err); return false }
  }
}