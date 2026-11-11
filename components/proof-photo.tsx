import { ImageIcon } from "lucide-react"
import type { CollectorReport } from "@/lib/types"

// Small Cloudinary thumbnail of a full-size image link.
function thumbnail(url: string): string {
  return url.includes("/upload/") ? url.replace("/upload/", "/upload/c_fill,w_112,h_112,q_auto,f_auto/") : url
}

// The collector's proof photo for a pickup: a thumbnail that opens full size,
// with who sent it and when. Shows nothing if there's no photo.
export function ProofPhoto({ report, compact = false }: { report?: CollectorReport | null; compact?: boolean }) {
  const url = report?.photoUrl
  if (!url) return null
  if (url.startsWith("firebase:")) {
    return <div className="text-[11px] text-muted-foreground">Proof photo saved as a backup copy (not viewable here)</div>
  }
  const when = report?.at
    ? new Date(report.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : ""
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground"
      title="Open the collector's proof photo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnail(url)}
        alt="Proof photo"
        className={`${compact ? "h-10 w-10" : "h-14 w-14"} shrink-0 rounded-md border object-cover`}
        loading="lazy"
      />
      <span>
        <span className="flex items-center gap-1 font-medium text-green-700"><ImageIcon className="h-3 w-3" /> Proof photo</span>
        {(report?.collectorName || when) && <span className="block">{[report?.collectorName, when].filter(Boolean).join(" · ")}</span>}
      </span>
    </a>
  )
}
