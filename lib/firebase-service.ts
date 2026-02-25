import {
  collection,
  query,
  limit,
  getDocs,
  doc,
  updateDoc,
  onSnapshot,
  orderBy,
  type QuerySnapshot,
  type DocumentData,
  Timestamp,
} from "firebase/firestore"
import { db } from "./firebase"
import type { WasteRequest, UserData, DashboardStats } from "./types"

// ======================
// SAFE DATE PARSER
// ======================
function parseDate(value: any): Date {
  if (!value) return new Date()

  // Firestore Timestamp
  if (value instanceof Timestamp) {
    return value.toDate()
  }

  // ISO string
  if (typeof value === "string") {
    return new Date(value)
  }

  // Already Date
  if (value instanceof Date) {
    return value
  }

  return new Date()
}

// ======================
// NORMALIZE FIRESTORE → WasteRequest
// ======================
function normalizeRequest(data: any, id: string): WasteRequest {
  const createdAt = parseDate(data.requestDate || data.createdAt)
  const updatedAt = parseDate(data.updatedAt || createdAt)

  return {
    id,
    customerName: data.customerName ?? data.name ?? "",
    customerPhone: data.customerPhone ?? data.customerNumber ?? "",
    address: data.address ?? "",
    wasteType: data.wasteType ?? "",
    pickupDate: data.pickupDate ?? "",
    paymentReceiptUrl: data.paymentReceiptUrl ?? data.receiptUrl ?? "",
    status: data.status ?? "pending",
    createdAt,
    updatedAt,
  }
}

export class FirebaseService {
  // ======================
  // DASHBOARD STATS (REALTIME)
  // ======================
  static subscribeToDashboardStats(
    callback: (stats: DashboardStats) => void,
  ): () => void {
    const q = query(
      collection(db, "pickupRequests"),
     orderBy("createdAt", "desc"),
      limit(1000),
    )

    return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
      const requests = snapshot.docs.map((doc) =>
        normalizeRequest(doc.data(), doc.id),
      )

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      callback({
        totalRequests: requests.length,
        pendingRequests: requests.filter((r) => r.status === "pending").length,
        completedRequests: requests.filter((r) => r.status === "completed").length,
        todayRequests: requests.filter((r) => r.createdAt >= today).length,
      })
    })
  }

  // ======================
  // PICKUP REQUESTS (REALTIME)
  // ======================
  static subscribeToPickupRequests(
    callback: (requests: WasteRequest[]) => void,
    limitCount = 50,
  ): () => void {
    const q = query(
      collection(db, "pickupRequests"),
     orderBy("createdAt", "desc"),
      limit(limitCount),
    )

    return onSnapshot(q, (snapshot) => {
      const requests = snapshot.docs.map((doc) =>
        normalizeRequest(doc.data(), doc.id),
      )
      callback(requests)
    })
  }

  // ======================
  // ONE-TIME FETCH
  // ======================
  static async getPickupRequests(limitCount = 50): Promise<WasteRequest[]> {
    try {
      const q = query(
        collection(db, "pickupRequests"),
       orderBy("createdAt", "desc"),
        limit(limitCount),
      )

      const snap = await getDocs(q)

      return snap.docs.map((doc) =>
        normalizeRequest(doc.data(), doc.id),
      )
    } catch (error) {
      console.error("Error fetching pickup requests:", error)
      return []
    }
  }

  // ======================
  // BACKWARD COMPATIBILITY
  // ======================
  static subscribeToWasteRequests(
    callback: (requests: WasteRequest[]) => void,
    limitCount = 50,
  ): () => void {
    return this.subscribeToPickupRequests(callback, limitCount)
  }

  static getWasteRequests(limitCount = 50): Promise<WasteRequest[]> {
    return this.getPickupRequests(limitCount)
  }

  // ======================
  // USERS AGGREGATION
  // ======================
  static async getUsersData(): Promise<UserData[]> {
    const q = query(
      collection(db, "pickupRequests"),
     orderBy("createdAt", "desc"),
      limit(1000),
    )

    const snap = await getDocs(q)
    const users = new Map<string, UserData>()

    snap.docs.forEach((doc) => {
      const r = normalizeRequest(doc.data(), doc.id)

      const existing = users.get(r.customerPhone)

      if (existing) {
        existing.totalRequests++

        if (r.createdAt > existing.lastRequestDate) {
          existing.lastRequestDate = r.createdAt
          existing.address = r.address
          existing.name = r.customerName
        }
      } else {
        users.set(r.customerPhone, {
          phoneNumber: r.customerPhone,
          name: r.customerName,
          address: r.address,
          totalRequests: 1,
          lastRequestDate: r.createdAt,
        })
      }
    })

    return Array.from(users.values())
  }

  // ======================
  // UPDATE STATUS
  // ======================
  static async updateRequestStatus(
    requestId: string,
    status: WasteRequest["status"],
  ): Promise<boolean> {
    try {
      const ref = doc(db, "pickupRequests", requestId)

      await updateDoc(ref, {
        status,
        updatedAt: new Date().toISOString(),
      })

      return true
    } catch (err) {
      console.error("Status update failed", err)
      return false
    }
  }
}