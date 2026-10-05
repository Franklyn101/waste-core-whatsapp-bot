import {
  collection,
  getDocs,
  doc,
  updateDoc,
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
}