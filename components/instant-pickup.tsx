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

interface InstantPickupTableProps {
  searchQuery?: string
}

export function InstantPickupTable({ searchQuery = "" }: InstantPickupTableProps) {
  const [requests, setRequests] = useState<WasteRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
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

  // Subscribe to Firestore instantPickups
  useEffect(() => {
    setIsLoading(true)

    const unsubscribe = FirebaseService.subscribeToInstantPickups((newRequests) => {
      setRequests(newRequests)
      setIsLoading(false)
      setIsConnected(true)
    })

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

  // Apply filters
  const filteredRequests = useFilteredRequests(
    requests.filter(r => r.serviceType === "instant"),
    filters
  )

  const availableStatuses = Array.from(new Set(requests.map((r) => r.status)))
  const availableWasteTypes = Array.from(new Set(requests.map((r) => r.wasteType)))

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "bg-yellow-100 text-yellow-800",
      assigned: "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
      incomplete: "bg-orange-100 text-orange-800",
      cancelled: "bg-red-100 text-red-800",
    }
    return variants[status as keyof typeof variants] || variants.pending
  }

  const handleStatusUpdate = async (requestId: string, newStatus: string) => {
    const success = await FirebaseService.updateInstantPickupStatus(requestId, newStatus)
    if (!success) alert("Failed to update status")
  }

  const handleViewReceipt = (url: string | undefined) => {
    if (url) window.open(url, "_blank")
  }

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
            <CardTitle>Instant Pickups</CardTitle>
          </CardHeader>
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
              Instant Pickups ({filteredRequests.length}
              {filteredRequests.length !== requests.length && ` of ${requests.length}`})
            </span>
            <div className="flex items-center gap-2 text-sm">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-green-600" />
                  <span className="text-green-600">Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-400">Offline</span>
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
                      <Phone className="w-4 h-4 text-gray-400" />
                      <span className="text-sm">{request.customerPhone}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="text-sm max-w-xs truncate">{request.address}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.wasteType}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
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
                      <span className="text-sm text-gray-400">No receipt</span>
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
                        {request.status === "pending" && (
                          <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "assigned")}>
                            Assign Pickup
                          </DropdownMenuItem>
                        )}
                        {request.status !== "completed" && (
                          <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "completed")}>
                            Mark as Completed
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "cancelled")}>
                          Cancel Pickup
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredRequests.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              {filters.searchQuery || filters.status.length > 0 || filters.wasteTypes.length > 0
                ? "No requests match your filters."
                : "No instant pickups found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}