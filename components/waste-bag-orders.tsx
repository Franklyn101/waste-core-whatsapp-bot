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
  Package,
  Wifi,
  WifiOff,
  Eye,
  ShoppingBag,
} from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { FirebaseService } from "@/lib/firebase-service"
import type { WasteBagOrder } from "@/lib/types"

interface WasteBagOrdersTableProps {
  searchQuery?: string
}

export function WasteBagOrdersTable({ searchQuery = "" }: WasteBagOrdersTableProps) {
  const [orders, setOrders] = useState<WasteBagOrder[]>([])
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

    const unsubscribe = FirebaseService.subscribeToWasteBagOrders((newOrders) => {
      setOrders(newOrders)
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

  const filteredOrders = useFilteredRequests(orders, filters)

  const availableStatuses = Array.from(new Set(orders.map((o) => o.status)))
  const availableBagSizes = Array.from(new Set(orders.map((o) => o.bagSize)))

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      pending:   "bg-yellow-100 text-yellow-800",
      confirmed: "bg-blue-100 text-blue-800",
      delivered: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    }
    return variants[status] ?? variants.pending
  }

  const getBagSizeBadge = (size: string) => {
    const variants: Record<string, string> = {
      small:  "bg-sky-100 text-sky-800",
      medium: "bg-violet-100 text-violet-800",
      large:  "bg-orange-100 text-orange-800",
    }
    return variants[size] ?? "bg-gray-100 text-gray-800"
  }

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    const success = await FirebaseService.updateWasteBagOrderStatus(orderId, newStatus)
    if (!success) alert("Failed to update order status")
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
          <CardHeader><CardTitle>Waste Bag Orders</CardTitle></CardHeader>
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
        availableWasteTypes={availableBagSizes}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-green-600" />
              <span>
                Waste Bag Orders ({filteredOrders.length}
                {filteredOrders.length !== orders.length && ` of ${orders.length}`})
              </span>
            </div>
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
                <TableHead>Delivery Address</TableHead>
                <TableHead>Bag Size</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Total (NGN)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.customerName}</TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <span className="text-sm">{order.customerPhone}</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="text-sm max-w-xs truncate">{order.deliveryAddress}</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge className={getBagSizeBadge(order.bagSize)}>
                      {order.bagSize.charAt(0).toUpperCase() + order.bagSize.slice(1)}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-400" />
                      <span className="text-sm">
                        {order.quantity} pack{order.quantity !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className="text-sm font-medium">
                      NGN {order.totalAmount.toLocaleString()}
                    </span>
                  </TableCell>

                  <TableCell>
                    <Badge className={getStatusBadge(order.status)}>{order.status}</Badge>
                  </TableCell>

                  <TableCell>
                    {order.paymentReceiptUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => handleViewReceipt(order.paymentReceiptUrl)}
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
                        {order.status === "pending" && (
                          <DropdownMenuItem
                            onClick={() => handleStatusUpdate(order.id, "confirmed")}
                          >
                            Confirm Order
                          </DropdownMenuItem>
                        )}
                        {order.status === "confirmed" && (
                          <DropdownMenuItem
                            onClick={() => handleStatusUpdate(order.id, "delivered")}
                          >
                            Mark as Delivered
                          </DropdownMenuItem>
                        )}
                        {order.status !== "delivered" && (
                          <DropdownMenuItem
                            onClick={() => handleStatusUpdate(order.id, "cancelled")}
                          >
                            Cancel Order
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredOrders.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              {filters.searchQuery || filters.status.length > 0 || filters.wasteTypes.length > 0
                ? "No orders match your filters."
                : "No waste bag orders found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}