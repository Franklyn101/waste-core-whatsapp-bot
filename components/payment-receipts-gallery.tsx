"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Eye, Download, User, Calendar } from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { FirebaseService } from "@/lib/firebase-service"
import type { WasteRequest } from "@/lib/types"

interface PaymentReceiptsGalleryProps {
  searchQuery?: string
}

export function PaymentReceiptsGallery({ searchQuery = "" }: PaymentReceiptsGalleryProps) {
  const [allRequests, setAllRequests] = useState<WasteRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filters, setFilters] = useState<FilterOptions>({
    status: [],
    wasteTypes: [],
    dateRange: { from: null, to: null },
    searchQuery: searchQuery,
  })

  // Update search query from props
  useEffect(() => {
    setFilters((prev) => ({ ...prev, searchQuery }))
  }, [searchQuery])

  // Load all requests from Firebase
  useEffect(() => {
    const loadReceipts = async () => {
      setIsLoading(true)
      try {
        const data = await FirebaseService.getWasteRequests(100)
        setAllRequests(data)
      } catch (error) {
        console.error("Error loading receipts:", error)
      } finally {
        setIsLoading(false)
      }
    }
    loadReceipts()
  }, [])

  const filteredRequests = useFilteredRequests(allRequests, filters)
  const receipts = filteredRequests.filter((request) => request.paymentReceiptUrl)

  // Unique values for filter options
  const requestsWithReceipts = allRequests.filter((r) => r.paymentReceiptUrl)
  const availableStatuses = Array.from(new Set(requestsWithReceipts.map((r) => r.status)))
  const availableWasteTypes = Array.from(new Set(requestsWithReceipts.map((r) => r.wasteType)))

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment Receipts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdvancedFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableStatuses={availableStatuses}
        availableWasteTypes={availableWasteTypes}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            Payment Receipts ({receipts.length}
            {receipts.length !== requestsWithReceipts.length && ` of ${requestsWithReceipts.length}`})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {receipts.map((receipt) => (
              <div key={receipt.id} className="group relative">
                <div className="aspect-square bg-muted rounded-lg overflow-hidden border">
                  {receipt.paymentReceiptUrl ? (
                    <img
                      src={receipt.paymentReceiptUrl.replace("/upload/", "/upload/f_auto,q_auto/")}
                      alt={`Payment receipt for ${receipt.customerName}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        console.log("[v0] Failed to load Cloudinary image:", receipt.paymentReceiptUrl)
                        e.currentTarget.src = "/payment-receipt-not-available.png"
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      No image available
                    </div>
                  )}

                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Payment Receipt - {receipt.customerName}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                            {receipt.paymentReceiptUrl && (
                              <img
                                src={receipt.paymentReceiptUrl.replace("/upload/", "/upload/f_auto,q_auto/")}
                                alt={`Payment receipt for ${receipt.customerName}`}
                                className="w-full h-full object-contain"
                              />
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Customer:</span>
                              <p className="font-medium">{receipt.customerName}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Phone:</span>
                              <p className="font-medium">{receipt.customerPhone}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Waste Type:</span>
                              <p className="font-medium">{receipt.wasteType}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Status:</span>
                              <Badge className="ml-2">{receipt.status}</Badge>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {receipt.paymentReceiptUrl && (
                      <Button size="sm" variant="secondary" asChild>
                        <a
                          href={receipt.paymentReceiptUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-3 h-3 text-muted-foreground" />
                    <span className="font-medium">{receipt.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{new Date(receipt.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {receipts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
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