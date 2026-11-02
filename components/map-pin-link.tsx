import { AlertTriangle, MapPinned } from "lucide-react"
import type { GeoPin } from "@/lib/types"

// Google Maps link to the exact location pin a customer shared on WhatsApp.
export function mapPinUrl(pin: GeoPin): string {
  return `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`
}

export function MapPinLink({ pin, outsideArea }: { pin?: GeoPin | null; outsideArea?: boolean }) {
  const warning = outsideArea ? (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800"
      title="The customer's location pin is outside the service area. Confirm before the pickup."
    >
      <AlertTriangle className="h-3 w-3" /> Outside area
    </span>
  ) : null
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return warning
  return (
    <>
    {warning}
    <a
      href={mapPinUrl(pin)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-green-700 hover:underline"
      title={[pin.name, pin.address].filter(Boolean).join(", ") || "Location pin shared on WhatsApp"}
    >
      <MapPinned className="h-3 w-3" /> Pin
    </a>
    </>
  )
}
