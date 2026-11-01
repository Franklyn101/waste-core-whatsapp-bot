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

// A pickup from either pickup collection, or one day's visit for a
// subscriber (subscriptionVisits/{subscriberId}_{date}), as shown on the
// Collectors page.
export interface CollectorPickup {
  id: string
  collection: PickupCollection | "subscriptionVisits"
  customerName: string
  customerPhone: string
  address: string
  wasteType: string
  bagCount: number | null
  pickupDate: string
  serviceType: string
  status: string
  collectorId: string | null
  collectorName: string
  timeWindow?: string
  // Subscription visits only.
  subscriberId?: string
  planId?: string
  // Outcome of the bot's WhatsApp message to the collector.
  collectorMessage?: { status: string; at?: string } | null
  createdAt: Date
}

export type SubscriberStatus = "active" | "paused" | "cancelled"

export type SubscriberInput = {
  customerName: string
  customerPhone: string
  address: string
  wasteType: string
  planId: string
  pickupDays: string[]
  timeWindow: string
  startDate: string
  status: SubscriberStatus
  notes: string
  // WhatsApp request this subscriber was created from (hides that row).
  linkedRequestId?: string | null
}

// One row on the Subscriptions page: either registered by an admin
// (`subscribers`, fully editable) or a WhatsApp booking (read-only).
export interface SubscriptionRow extends SubscriberInput {
  id: string
  source: "admin" | "whatsapp"
  collection: "subscribers" | "pickupRequests" | "upgradeRequests"
  kind: "business" | "household" | "weekly"
  // Raw status from the WhatsApp booking (pending, assigned, ...).
  requestStatus?: string
  // Outcome of the WhatsApp confirmation the bot sends to a subscriber added
  // on the dashboard: sending, template, text, failed or invalid_phone.
  whatsAppConfirmation?: { status: string; at?: string } | null
  // Monthly payments. paidUntil is the date the next payment is due; the
  // bot sets these for WhatsApp payments, admins record the rest.
  payment: SubscriptionPayment
  // Outcome of the last "Send renewal reminder".
  renewalReminder?: { status: string; at?: string; requestedAt?: string } | null
  createdAt: Date
}

export interface SubscriptionPayment {
  paidUntil: string | null
  lastPaymentDate: string | null
  lastPaymentAmount: number | null
  lastPaymentMethod: string | null
  // WhatsApp bank-transfer receipt not yet verified by an admin.
  receiptUnverified: boolean
}

export interface PaymentInput {
  date: string
  amount: number
  method: string
  months: number
  paidUntil: string
}
