import { MapPinned } from "lucide-react"
import type { GeoPin } from "@/lib/types"

// Google Maps link to the exact location pin a customer shared on WhatsApp.
export function mapPinUrl(pin: GeoPin): string {
  return `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`
}

export function MapPinLink({ pin }: { pin?: GeoPin | null }) {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null
  return (
    <a
      href={mapPinUrl(pin)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-green-700 hover:underline"
      title={[pin.name, pin.address].filter(Boolean).join(", ") || "Location pin shared on WhatsApp"}
    >
      <MapPinned className="h-3 w-3" /> Pin
    </a>
  )
}
