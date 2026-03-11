"use client"

import { useState, useEffect } from "react"
import { collection, query, limit, onSnapshot, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  MoreHorizontal, Phone, MapPin, CalendarCheck,
  Wifi, WifiOff, Eye, TrendingUp,
} from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { FirebaseService } from "@/lib/firebase-service"
import type { UpgradeRequest } from "@/lib/types"

interface UpgradeRequestsTableProps {
  searchQuery?: string
}

const PLAN_PRICES: Record<string, number> = {
  basic: 12000,
  standard: 20000,
  premium: 35000,
}

export function UpgradeRequestsTable({ searchQuery = "" }: UpgradeRequestsTableProps) {
  const [requests, setRequests] = useState<UpgradeRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const [debugInfo, setDebugInfo] = useState<string>("Initializing...")
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
    setDebugInfo("Starting Firestore connection...")

    // DIRECT RAW QUERY — bypasses FirebaseService entirely
    const q = query(collection(db, "upgradeRequests"), limit(50))

    // Test 1: getDocs one-time fetch
    getDocs(q)
      .then((snap) => {
        setDebugInfo(
          `getDocs: ${snap.empty ? "EMPTY (0 docs)" : `${snap.docs.length} doc(s) found`} | ` +
          `metadata: fromCache=${snap.metadata.fromCache}`
        )
        if (!snap.empty) {
          console.log("RAW upgradeRequests docs:", snap.docs.map(d => ({ id: d.id, ...d.data() })))
        }
      })
      .catch((err) => {
        setDebugInfo(`getDocs ERROR: ${err.code} — ${err.message}`)
      })

    // Test 2: onSnapshot realtime
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        console.log("onSnapshot fired, docs:", snapshot.docs.length)
        if (snapshot.empty) {
          setDebugInfo((prev) => prev + " | onSnapshot: EMPTY")
          setIsLoading(false)
          return
        }

        const raw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as any))
        console.log("Raw upgrade docs:", raw)

        const normalized: UpgradeRequest[] = raw.map((data: any) => {
          let plan = data.plan ?? ""
          if (!plan && typeof data.serviceType === "string") {
            plan = data.serviceType.replace("upgrade_", "")
          }
          return {
            id:                data.id,
            customerName:      data.customerName ?? "",
            customerPhone:     data.customerPhone ?? "",
            address:           data.address ?? "",
            plan:              plan || "basic",
            serviceType:       data.serviceType ?? "",
            startDate:         data.startDate ?? "",
            paymentReceiptUrl: data.paymentReceiptUrl ?? "",
            status:            data.status ?? "pending",
            createdAt:         data.createdAt ? new Date(data.createdAt) : new Date(),
            updatedAt:         data.updatedAt ? new Date(data.updatedAt) : new Date(),
          }
        })

        setRequests(normalized.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))
        setDebugInfo(`onSnapshot: ${snapshot.docs.length} doc(s) loaded ✓`)
        setIsLoading(false)
      },
      (err) => {
        console.error("onSnapshot error:", err)
        setDebugInfo(`onSnapshot ERROR: ${err.code} — ${err.message}`)
        setIsLoading(false)
      }
    )

    const handleOffline = () => setIsConnected(false)
    const handleOnline  = () => setIsConnected(true)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("online",  handleOnline)

    return () => {
      unsub()
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online",  handleOnline)
    }
  }, [])

  const filteredRequests = useFilteredRequests(requests, filters)
  const availableStatuses = Array.from(new Set(requests.map((r) => r.status)))
  const availablePlans    = Array.from(new Set(requests.map((r) => r.plan)))

  const getStatusBadge = (status: string) => ({
    pending:   "bg-yellow-100 text-yellow-800",
    active:    "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  }[status] ?? "bg-yellow-100 text-yellow-800")

  const getPlanBadge = (plan: string) => ({
    basic:    "bg-slate-100 text-slate-700",
    standard: "bg-blue-100 text-blue-800",
    premium:  "bg-amber-100 text-amber-800",
  }[plan] ?? "bg-gray-100 text-gray-800")

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await FirebaseService.updateUpgradeRequestStatus(id, status)
    } catch (err) {
      alert("Failed to update status")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Debug banner */}
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs font-mono text-yellow-800">
          🔍 Debug: {debugInfo}
        </div>
        <Card>
          <CardHeader><CardTitle>Upgrade Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
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

      {/* Debug banner — shows what Firestore returned */}
      <div className={`border rounded p-3 text-xs font-mono ${
        debugInfo.includes("ERROR") ? "bg-red-50 border-red-200 text-red-800" :
        debugInfo.includes("EMPTY") ? "bg-orange-50 border-orange-200 text-orange-800" :
        "bg-green-50 border-green-200 text-green-800"
      }`}>
        🔍 {debugInfo}
      </div>

      <AdvancedFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableStatuses={availableStatuses}
        availableWasteTypes={availablePlans}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <span>
                Upgrade Requests ({filteredRequests.length}
                {filteredRequests.length !== requests.length && ` of ${requests.length}`})
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {isConnected
                ? <><Wifi className="w-4 h-4 text-green-600" /><span className="text-green-600">Live</span></>
                : <><WifiOff className="w-4 h-4 text-gray-400" /><span className="text-gray-400">Offline</span></>
              }
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
                <TableHead>Plan</TableHead>
                <TableHead>Monthly Fee</TableHead>
                <TableHead>Start Date</TableHead>
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
                    <Badge className={getPlanBadge(request.plan)}>
                      {request.plan.charAt(0).toUpperCase() + request.plan.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">
                      NGN {PLAN_PRICES[request.plan]?.toLocaleString() ?? "—"}/mo
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="w-4 h-4 text-gray-400" />
                      <span className="text-sm">{request.startDate || "—"}</span>
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
                        onClick={() => window.open(request.paymentReceiptUrl, "_blank")}
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
                          <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "active")}>
                            Activate Plan
                          </DropdownMenuItem>
                        )}
                        {request.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => handleStatusUpdate(request.id, "cancelled")}>
                            Cancel Plan
                          </DropdownMenuItem>
                        )}
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
                ? "No upgrade requests match your filters."
                : "No upgrade requests found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}