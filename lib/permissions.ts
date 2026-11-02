import type { AdminProfile } from "@/lib/admin-auth"

// What sub-admins may do. The main admin can do everything; each sub-admin
// gets these switches on the Sub-admins page (stored in admins/{uid}).
export type Permission = "viewRevenue" | "recordPayments" | "deleteRecords" | "sendBroadcasts"

export const PERMISSIONS: { id: Permission; label: string; description: string; subDefault: boolean }[] = [
  { id: "viewRevenue", label: "View revenue reports", description: "See income and download reports.", subDefault: false },
  { id: "recordPayments", label: "Record payments", description: "Record subscription payments, verify receipts and mark collector payouts.", subDefault: false },
  { id: "deleteRecords", label: "Delete records", description: "Delete subscribers and collectors.", subDefault: false },
  { id: "sendBroadcasts", label: "Send broadcasts", description: "Send announcements to customers on WhatsApp.", subDefault: false },
]

export function can(profile: AdminProfile | null | undefined, permission: Permission): boolean {
  if (!profile) return false
  if (profile.role === "main") return true
  return profile.permissions?.[permission] ?? PERMISSIONS.find((p) => p.id === permission)?.subDefault ?? false
}
