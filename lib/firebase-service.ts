import {
  collection,
  query,
  limit,
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
function parseDate(value: any): Date {
  if (!value) return new Date()
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value === "string") return new Date(value)
  if (value instanceof Date) return value
  return new Date()
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
// CLIENT-SIDE SORT — no orderBy, no index needed
// ======================
function sortByCreatedAt<T extends { createdAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

// ======================
// FIREBASE SERVICE
// NOTE: All queries use NO orderBy — sorted client-side instead.
// orderBy requires a Firestore index per collection. New collections
// (upgradeRequests, supportTickets) don't have indexes yet and fail silently.
// ======================
export class FirebaseService {

  // ── DASHBOARD STATS ───────────────────────────────────────────────────────
  static subscribeToDashboardStats(
    callback: (stats: DashboardStats) => void
  ): () => void {
    const q = query(collection(db, "pickupRequests"), limit(1000))
    return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
      const requests = snapshot.docs.map((d) => normalizeRequest(d.data(), d.id))
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      callback({
        totalRequests:     requests.length,
        pendingRequests:   requests.filter((r) => r.status === "pending").length,
        completedRequests: requests.filter((r) => r.status === "completed").length,
        todayRequests:     requests.filter((r) => r.createdAt >= today).length,
      })
    })
  }

  // ── PICKUP REQUESTS ───────────────────────────────────────────────────────
  static subscribeToPickupRequests(
    callback: (requests: WasteRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = query(collection(db, "pickupRequests"), limit(limitCount))
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeRequest(d.data(), d.id)))),
      (err) => { console.error("pickupRequests error:", err); onError?.(err) }
    )
  }

  // ── INSTANT PICKUPS ───────────────────────────────────────────────────────
  static subscribeToInstantPickups(
    callback: (requests: WasteRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = query(collection(db, "instantPickups"), limit(limitCount))
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeRequest(d.data(), d.id)))),
      (err) => { console.error("instantPickups error:", err); onError?.(err) }
    )
  }

  // ── WASTE BAG ORDERS ──────────────────────────────────────────────────────
  static subscribeToWasteBagOrders(
    callback: (orders: WasteBagOrder[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = query(collection(db, "wasteBagOrders"), limit(limitCount))
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeWasteBagOrder(d.data(), d.id)))),
      (err) => { console.error("wasteBagOrders error:", err); onError?.(err) }
    )
  }

  // ── UPGRADE REQUESTS ──────────────────────────────────────────────────────
  static subscribeToUpgradeRequests(
    callback: (requests: UpgradeRequest[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = query(collection(db, "upgradeRequests"), limit(limitCount))
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeUpgradeRequest(d.data(), d.id)))),
      (err) => { console.error("upgradeRequests error:", err); onError?.(err) }
    )
  }

  // ── SUPPORT TICKETS ───────────────────────────────────────────────────────
  static subscribeToSupportTickets(
    callback: (tickets: SupportTicket[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const q = query(collection(db, "supportTickets"), limit(limitCount))
    return onSnapshot(
      q,
      (snapshot) => callback(sortByCreatedAt(snapshot.docs.map((d) => normalizeSupportTicket(d.data(), d.id)))),
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
    const snap = await getDocs(query(collection(db, "pickupRequests"), limit(limitCount)))
    return sortByCreatedAt(snap.docs.map((d) => normalizeRequest(d.data(), d.id)))
  }

  static async getInstantPickups(limitCount = 50): Promise<WasteRequest[]> {
    const snap = await getDocs(query(collection(db, "instantPickups"), limit(limitCount)))
    return sortByCreatedAt(snap.docs.map((d) => normalizeRequest(d.data(), d.id)))
  }

  static async getWasteBagOrders(limitCount = 50): Promise<WasteBagOrder[]> {
    const snap = await getDocs(query(collection(db, "wasteBagOrders"), limit(limitCount)))
    return sortByCreatedAt(snap.docs.map((d) => normalizeWasteBagOrder(d.data(), d.id)))
  }

  static async getUpgradeRequests(limitCount = 50): Promise<UpgradeRequest[]> {
    const snap = await getDocs(query(collection(db, "upgradeRequests"), limit(limitCount)))
    return sortByCreatedAt(snap.docs.map((d) => normalizeUpgradeRequest(d.data(), d.id)))
  }

  static async getSupportTickets(limitCount = 50): Promise<SupportTicket[]> {
    const snap = await getDocs(query(collection(db, "supportTickets"), limit(limitCount)))
    return sortByCreatedAt(snap.docs.map((d) => normalizeSupportTicket(d.data(), d.id)))
  }
}