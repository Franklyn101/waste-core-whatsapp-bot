import type { AdminProfile } from "@/lib/admin-auth"

// What sub-admins may do. The main admin can do everything; each sub-admin
// gets these switches on the Sub-admins page (stored in admins/{uid}).
export type Permission =
  | "viewRevenue" | "recordPayments" | "deleteRecords" | "sendBroadcasts" | "collectorPayouts" | "editCollectors"

export const PERMISSIONS: { id: Permission; label: string; description: string; subDefault: boolean }[] = [
  { id: "viewRevenue", label: "View revenue reports", description: "See income and download reports.", subDefault: false },
  { id: "recordPayments", label: "Record payments", description: "Record subscription payments and verify customers' receipts.", subDefault: false },
  { id: "collectorPayouts", label: "Collector payouts", description: "Record payouts to collectors, set the pay per pickup, and add or change collectors' bank accounts.", subDefault: false },
  { id: "editCollectors", label: "Edit collectors", description: "Register collectors, edit their details, and make them active or inactive.", subDefault: true },
  { id: "deleteRecords", label: "Delete records", description: "Delete subscribers and collectors.", subDefault: false },
  { id: "sendBroadcasts", label: "Send broadcasts", description: "Send announcements to customers on WhatsApp.", subDefault: false },
]

export function can(profile: AdminProfile | null | undefined, permission: Permission): boolean {
  if (!profile) return false
  if (profile.role === "main") return true
  return profile.permissions?.[permission] ?? PERMISSIONS.find((p) => p.id === permission)?.subDefault ?? false
}
