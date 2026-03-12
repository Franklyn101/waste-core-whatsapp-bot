"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  MoreHorizontal,
  Phone,
  MapPin,
  Calendar,
  Wifi,
  WifiOff,
  Eye,
} from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { FirebaseService } from "@/lib/firebase-service"
import type { WasteRequest } from "@/lib/types"

// Maps serviceType stored in Firestore to a human-readable label
const SERVICE_LABELS: Record<string, string> = {
  instant:   "Instant Pickup",
  weekly_1:  "1 pickup/week",
  weekly_2:  "2 pickups/week",
  weekly_3:  "3 pickups/week",
  monthly:   "Monthly",          // legacy — kept for old records
}

function getServiceLabel(request: WasteRequest): string {
  // Use serviceLabel field if present (new records), fall back to SERVICE_LABELS map
  return (request as any).serviceLabel
    || SERVICE_LABELS[request.serviceType]
    || request.serviceType
    || "—"
}

interface PickupRequestsTableProps {
  searchQuery?: string
}

export function PickupRequestsTable({ searchQuery = "" }: PickupRequestsTableProps) {
  const [requests, setRequests] = useState<WasteRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const [filters, setFilters] = useState<FilterOptions>({
    status: [],
    wasteTypes: [],
    dateRange: { from: null, to: null },
    searchQuery: searchQuery,
  })

  useEffect(() => {
    setFilters((prev) => ({ ...prev, searchQuery }))
  }, [searchQuery])

  useEffect(() => {
    setIsLoading(true)

    const unsubscribe = FirebaseService.subscribeToPickupRequests((newRequests) => {
      setRequests(newRequests)
      setIsLoading(false)
      setIsConnected(true)
    }, 100)

    const handleOffline = () => setIsConnected(false)
    const handleOnline = () => setIsConnected(true)

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    return () => {
      unsubscribe()
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [])

  const filteredRequests = useFilteredRequests(requests, filters)
  const availableStatuses = Array.from(new Set(requests.map((r) => r.status)))
  const availableWasteTypes = Array.from(new Set(requests.map((r) => r.wasteType)))

  const getStatusBadge = (status: string) => {
    const variants = {
      pending:   "bg-chart-2/20 text-chart-2 hover:bg-chart-2/30",
      confirmed: "bg-chart-1/20 text-chart-1 hover:bg-chart-1/30",
      completed: "bg-chart-3/20 text-chart-3 hover:bg-chart-3/30",
      cancelled: "bg-destructive/20 text-destructive hover:bg-destructive/30",
    }
    return variants[status as keyof typeof variants] || variants.pending
  }

  const getServiceBadge = (serviceType: string) => {
    if (serviceType === "instant") return "bg-blue-500/20 text-blue-600"
    if (serviceType?.startsWith("weekly")) return "bg-purple-500/20 text-purple-600"
    return "bg-muted text-muted-foreground"
  }

  const handleStatusUpdate = async (requestId: string, newStatus: string) => {
    await FirebaseService.updateRequestStatus(requestId, newStatus)
  }

  const handleViewReceipt = (url: string | undefined) => {
    if (url) window.open(url, "_blank")
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent>
            <div className="h-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pickup Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
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
          <CardTitle className="flex items-center justify-between">
            <span>
              Pickup Requests ({filteredRequests.length}
              {filteredRequests.length !== requests.length && ` of ${requests.length}`})
            </span>
            <div className="flex items-center gap-2 text-sm">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-chart-1" />
                  <span className="text-chart-1">Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Offline</span>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Waste Type</TableHead>
                <TableHead>Pickup Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">{request.customerName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{request.customerPhone}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getServiceBadge(request.serviceType)}>
                      {getServiceLabel(request)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm max-w-xs truncate">{request.address}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.wasteType}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{request.pickupDate}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusBadge(request.status)}>{request.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {request.paymentReceiptUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => handleViewReceipt(request.paymentReceiptUrl)}
                      >
                        <Eye className="w-4 h-4" /> View
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">No receipt</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "confirmed")}>
                          Mark as Confirmed
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "completed")}>
                          Mark as Completed
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "cancelled")}>
                          Cancel Request
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredRequests.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {filters.searchQuery || filters.status.length > 0 || filters.wasteTypes.length > 0
                ? "No requests match your filters."
                : "No pickup requests found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}