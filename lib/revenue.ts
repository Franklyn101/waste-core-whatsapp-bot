import { collection, getDocs } from "firebase/firestore"
import { db } from "./firebase"
import { findPlan, planFullLabel } from "./subscriptions"

// One payment received, from any source.
export interface RevenueEntry {
  date: string // YYYY-MM-DD, Nigerian time
  amount: number
  service: string
  method: string
  customerName: string
  customerPhone: string
  details: string
  reference: string
  // PDF receipt, when one was issued (served by the bot server).
  receiptUrl: string
  receiptNumber: string
}

export interface RevenueData {
  entries: RevenueEntry[]
  // Bank-transfer receipts customers sent that nobody has verified yet.
  awaiting: { count: number; amount: number }
}

export const METHOD_LABELS: Record<string, string> = {
  paystack: "Paystack",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  pos: "POS",
  other: "Other",
}

// ISO timestamps are UTC; reports use the Nigerian calendar day.
export function lagosDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d)
}

const phoneOf = (data: any) => String(data.customerPhone ?? "").replace(/^whatsapp:/i, "")

const BOOKING_SOURCES: { col: string; service: string }[] = [
  { col: "instantPickups", service: "Instant pickup" },
  { col: "pickupRequests", service: "Scheduled pickup" },
  { col: "wasteBagOrders", service: "Waste bags" },
]

// Every payment: paid one-off bookings, plus the payment history kept on
// subscriptions (first month, renewals, payments recorded on the dashboard).
export async function loadRevenue(): Promise<RevenueData> {
  const entries: RevenueEntry[] = []
  const awaiting = { count: 0, amount: 0 }

  const [bookings, plans, subscribers] = await Promise.all([
    Promise.all(BOOKING_SOURCES.map((s) => getDocs(collection(db, s.col)))),
    getDocs(collection(db, "upgradeRequests")),
    getDocs(collection(db, "subscribers")),
  ])

  bookings.forEach((snap, i) => {
    const { service } = BOOKING_SOURCES[i]
    for (const d of snap.docs) {
      const data = d.data()
      const amount = Number(data.totalAmount) || 0
      if (!amount || data.status === "cancelled") continue
      const paid = data.paymentMethod === "paystack" || data.paymentStatus === "paid"
      if (!paid) {
        if (data.paymentReceiptUrl) { awaiting.count++; awaiting.amount += amount }
        continue
      }
      entries.push({
        date: lagosDate(data.paidAt || data.receiptVerifiedAt || data.createdAt || ""),
        amount,
        service,
        method: data.paymentMethod || "bank_transfer",
        customerName: data.customerName ?? "",
        customerPhone: phoneOf(data),
        details: data.bagCount ? `${data.bagCount} bag${data.bagCount > 1 ? "s" : ""}`
          : data.bagSize ? `${data.bagSize} × ${data.quantity ?? 1}` : "",
        reference: data.paymentReference ?? "",
        receiptUrl: data.receiptToken ? `/receipts/${data.receiptToken}.pdf` : "",
        receiptNumber: data.receiptNumber && data.receiptNumber !== "issuing" ? data.receiptNumber : "",
      })
    }
  })

  for (const snap of [plans, subscribers]) {
    for (const d of snap.docs) {
      const data = d.data()
      const planId = data.planId || data.plan || String(data.serviceType ?? "").replace(/^upgrade_/, "")
      const plan = findPlan(planId)
      const payments: any[] = Array.isArray(data.payments) ? data.payments : []
      if (!payments.length && data.paymentMethod === "bank_transfer" && data.paymentStatus !== "paid" && data.paymentReceiptUrl) {
        awaiting.count++
        awaiting.amount += Number(data.totalAmount) || 0
      }
      for (const p of payments) {
        const amount = Number(p.amount) || 0
        if (!amount) continue
        entries.push({
          date: lagosDate(p.date || ""),
          amount,
          service: "Subscription",
          method: p.method || "other",
          customerName: data.customerName ?? "",
          customerPhone: phoneOf(data),
          details: `${plan ? planFullLabel(plan) : planId}${p.months > 1 ? ` · ${p.months} months` : ""}`,
          reference: p.reference ?? "",
          receiptUrl: p.receiptToken ? `/receipts/${p.receiptToken}.pdf` : "",
          receiptNumber: p.receiptNumber ?? "",
        })
      }
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date))
  return { entries, awaiting }
}

export function revenueCsv(entries: RevenueEntry[]): string {
  const cell = (v: string | number) => {
    const text = String(v ?? "")
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const rows = [
    ["Date", "Customer", "Phone", "Service", "Details", "Method", "Amount (NGN)", "Reference", "Receipt"],
    ...entries.map((e) => [e.date, e.customerName, e.customerPhone, e.service, e.details, METHOD_LABELS[e.method] ?? e.method, e.amount, e.reference, e.receiptNumber]),
  ]
  return rows.map((r) => r.map(cell).join(",")).join("\n")
}
