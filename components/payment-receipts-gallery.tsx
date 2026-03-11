"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Eye, Download, User, Calendar, Package } from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { collection, getDocs, query, limit } from "firebase/firestore"
import { db } from "@/lib/firebase"

// Unified receipt shape pulled from all collections
interface ReceiptRecord {
  id: string
  customerName: string
  customerPhone: string
  paymentReceiptUrl: string
  status: string
  serviceType: string
  serviceLabel: string   // human-readable: "Instant Pickup", "Monthly Subscription", etc.
  serviceDetail: string  // e.g. waste type, plan name, bag size
  amount: number
  date: string           // ISO string from createdAt
  createdAt: Date
  wasteType: string      // used by filter slot
}

const SERVICE_PRICES: Record<string, number> = {
  instant:          2000,
  monthly:          10000,
  upgrade_basic:    12000,
  upgrade_standard: 20000,
  upgrade_premium:  35000,
  wasteBags_small:  500,
  wasteBags_medium: 900,
  wasteBags_large:  1500,
}

function parseDate(value: any): Date {
  if (!value) return new Date()
  if (typeof value === "string") return new Date(value)
  if (value?.toDate) return value.toDate()
  if (value instanceof Date) return value
  return new Date()
}

function serviceLabel(serviceType: string): string {
  if (serviceType === "instant")  return "Instant Pickup"
  if (serviceType === "monthly")  return "Monthly Subscription"
  if (serviceType?.startsWith("upgrade_")) return "Plan Upgrade"
  if (serviceType === "wasteBags") return "Waste Bag Order"
  if (serviceType === "support")  return "Support"
  return serviceType ?? "Unknown"
}

function getAmount(doc: any): number {
  if (doc.totalAmount) return doc.totalAmount
  const key = doc.serviceType ?? ""
  if (SERVICE_PRICES[key]) return SERVICE_PRICES[key]
  if (doc.bagSize) return SERVICE_PRICES[`wasteBags_${doc.bagSize}`] ?? 0
  return 0
}

function getServiceDetail(col: string, doc: any): string {
  if (col === "instantPickups" || col === "pickupRequests") return doc.wasteType ?? ""
  if (col === "upgradeRequests") return `${(doc.plan ?? "").toUpperCase()} Plan`
  if (col === "wasteBagOrders")  return `${doc.bagSize ?? ""} × ${doc.quantity ?? 1} pack(s)`
  return ""
}

async function fetchAllReceipts(): Promise<ReceiptRecord[]> {
  const collections = ["instantPickups", "pickupRequests", "upgradeRequests", "wasteBagOrders"]
  const results: ReceiptRecord[] = []

  await Promise.all(
    collections.map(async (col) => {
      const snap = await getDocs(query(collection(db, col), limit(200)))
      snap.docs.forEach((d) => {
        const data = d.data()
        if (!data.paymentReceiptUrl) return // skip docs with no receipt
        const createdAt = parseDate(data.createdAt)
        results.push({
          id:                `${col}_${d.id}`,
          customerName:      data.customerName ?? "",
          customerPhone:     data.customerPhone ?? "",
          paymentReceiptUrl: data.paymentReceiptUrl,
          status:            data.status ?? "pending",
          serviceType:       data.serviceType ?? col,
          serviceLabel:      serviceLabel(data.serviceType),
          serviceDetail:     getServiceDetail(col, data),
          amount:            getAmount(data),
          date:              typeof data.createdAt === "string" ? data.createdAt : createdAt.toISOString(),
          createdAt,
          wasteType:         data.wasteType ?? data.bagSize ?? data.plan ?? "",
        })
      })
    })
  )

  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

const SERVICE_BADGE: Record<string, string> = {
  "Instant Pickup":        "bg-blue-100 text-blue-800",
  "Monthly Subscription":  "bg-purple-100 text-purple-800",
  "Plan Upgrade":          "bg-amber-100 text-amber-800",
  "Waste Bag Order":       "bg-green-100 text-green-800",
}

interface PaymentReceiptsGalleryProps {
  searchQuery?: string
}

export function PaymentReceiptsGallery({ searchQuery = "" }: PaymentReceiptsGalleryProps) {
  const [allReceipts, setAllReceipts] = useState<ReceiptRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterOptions>({
    status: [],
    wasteTypes: [],
    dateRange: { from: null, to: null },
    searchQuery,
  })

  useEffect(() => {
    setFilters((prev) => ({ ...prev, searchQuery }))
  }, [searchQuery])

  useEffect(() => {
    setIsLoading(true)
    fetchAllReceipts()
      .then((data) => { setAllReceipts(data); setIsLoading(false) })
      .catch((err) => { setError(err.message); setIsLoading(false) })
  }, [])

  const filteredReceipts = useFilteredRequests(allReceipts as any, filters) as unknown as ReceiptRecord[]

  const availableStatuses     = Array.from(new Set(allReceipts.map((r) => r.status)))
  const availableServiceTypes = Array.from(new Set(allReceipts.map((r) => r.serviceLabel)))

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Payment Receipts</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-8 text-center text-red-500">
          Failed to load receipts: {error}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <AdvancedFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableStatuses={availableStatuses}
        availableWasteTypes={availableServiceTypes}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            Payment Receipts ({filteredReceipts.length}
            {filteredReceipts.length !== allReceipts.length && ` of ${allReceipts.length}`})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredReceipts.map((receipt) => (
              <div key={receipt.id} className="group relative flex flex-col gap-2">

                {/* Image card */}
                <div className="relative aspect-square bg-muted rounded-lg overflow-hidden border">
                  <img
                    src={receipt.paymentReceiptUrl.replace("/upload/", "/upload/f_auto,q_auto/")}
                    alt={`Receipt for ${receipt.customerName}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "/payment-receipt-not-available.png"
                    }}
                  />

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <Eye className="w-4 h-4 mr-1" /> View
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Receipt — {receipt.customerName}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                            <img
                              src={receipt.paymentReceiptUrl.replace("/upload/", "/upload/f_auto,q_auto/")}
                              alt={`Receipt for ${receipt.customerName}`}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Customer</p>
                              <p className="font-medium">{receipt.customerName}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Phone</p>
                              <p className="font-medium">{receipt.customerPhone}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Service</p>
                              <Badge className={SERVICE_BADGE[receipt.serviceLabel] ?? "bg-gray-100 text-gray-800"}>
                                {receipt.serviceLabel}
                              </Badge>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Details</p>
                              <p className="font-medium">{receipt.serviceDetail || "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Amount Paid</p>
                              <p className="font-semibold text-green-700">
                                NGN {receipt.amount.toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                              <Badge>{receipt.status}</Badge>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs mb-0.5">Date</p>
                              <p className="font-medium">
                                {new Date(receipt.date).toLocaleDateString("en-NG", {
                                  day: "numeric", month: "short", year: "numeric",
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button size="sm" variant="secondary" asChild>
                      <a href={receipt.paymentReceiptUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4 mr-1" /> Download
                      </a>
                    </Button>
                  </div>
                </div>

                {/* Info below image */}
                <div className="space-y-1 px-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      {receipt.customerName}
                    </div>
                    <Badge className={`text-xs ${SERVICE_BADGE[receipt.serviceLabel] ?? "bg-gray-100 text-gray-800"}`}>
                      {receipt.serviceLabel}
                    </Badge>
                  </div>

                  {receipt.serviceDetail && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Package className="w-3 h-3" />
                      {receipt.serviceDetail}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      {new Date(receipt.date).toLocaleDateString("en-NG", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </div>
                    <span className="font-semibold text-green-700 text-sm">
                      NGN {receipt.amount.toLocaleString()}
                    </span>
                  </div>
                </div>

              </div>
            ))}
          </div>

          {filteredReceipts.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              {filters.searchQuery || filters.status.length > 0 || filters.wasteTypes.length > 0
                ? "No receipts match your filters."
                : "No payment receipts found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}