import { BadgeCheck } from "lucide-react"

// Shown instead of a receipt for bookings paid (and verified) via Paystack.
export function PaystackPaidBadge({ reference }: { reference?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
      title={reference ? `Paystack reference ${reference}` : undefined}
    >
      <BadgeCheck className="h-3.5 w-3.5" /> Paid · Paystack
    </span>
  )
}
