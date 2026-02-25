export interface WasteRequest {
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
