export interface WasteRequest {
  plan(plan: any): string | undefined;
  startDate: string;
  customerPhone(customerPhone: any, arg1: { phoneNumber: any; name: any; address: string; totalRequests: number; lastRequestDate: Date }): unknown
  id: string
  customerName: string
  customerPhone: string
  address: string
  wasteType: string
  pickupDate: string
  paymentReceiptUrl?: string
  status: "pending" | "confirmed" | "completed" | "cancelled"
  createdAt: string // Firestore stores ISO string
  updatedAt: string
  conversationStep?: number
}

export interface UserData {
  phoneNumber: string
  name: string
  address: string
  totalRequests: number
  lastRequestDate: Date
}

export interface DashboardStats {
  totalRequests: number
  pendingRequests: number
  completedRequests: number
  todayRequests: number
}

export interface Collector {
  id: string
  name: string
  phone: string
  area: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export type CollectorInput = Pick<Collector, "name" | "phone" | "area" | "active">

export type PickupCollection = "instantPickups" | "pickupRequests"

export type PickupStatus = "pending" | "assigned" | "completed" | "incomplete" | "cancelled"

// A pickup from either pickup collection, as shown on the Collectors page.
export interface CollectorPickup {
  id: string
  collection: PickupCollection
  customerName: string
  customerPhone: string
  address: string
  wasteType: string
  pickupDate: string
  serviceType: string
  status: string
  collectorId: string | null
  collectorName: string
  createdAt: Date
}
