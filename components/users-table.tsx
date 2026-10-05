"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Phone, MapPin, Calendar, User, ShoppingBag, TrendingUp, Truck, HeadphonesIcon } from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { collection, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"

interface ServiceCount {
  label: string
  count: number
}

interface CustomerRecord {
  phoneNumber: string
  name: string
  address: string
  totalRequests: number
  lastRequestDate: Date
  services: ServiceCount[]  // label + count per service
}

function parseDate(value: any): Date {
  if (!value) return new Date(0)
  if (typeof value === "string") return new Date(value)
  if (value?.toDate) return value.toDate()
  if (value instanceof Date) return value
  return new Date(0)
}

function cleanPhone(phone: string): string {
  return phone.replace("whatsapp:", "").trim()
}

function toWhatsAppLink(phone: string): string {
  const number = phone.replace("whatsapp:", "").replace(/\s+/g, "").replace(/^\+/, "")
  return `https://wa.me/${number}`
}

const SERVICE_COLLECTIONS = [
  { col: "instantPickups",  label: "Instant Pickup" },
  { col: "pickupRequests",  label: "Monthly Subscription" },
  { col: "upgradeRequests", label: "Plan Upgrade" },
  { col: "wasteBagOrders",  label: "Waste Bag Order" },
  { col: "supportTickets",  label: "Support" },
]

const SERVICE_BADGE: Record<string, string> = {
  "Instant Pickup":       "bg-blue-100 text-blue-800",
  "Monthly Subscription": "bg-purple-100 text-purple-800",
  "Plan Upgrade":         "bg-amber-100 text-amber-800",
  "Waste Bag Order":      "bg-green-100 text-green-800",
  "Support":              "bg-gray-100 text-gray-700",
}

const SERVICE_ICON: Record<string, React.ReactNode> = {
  "Instant Pickup":       <Truck className="w-3 h-3" />,
  "Monthly Subscription": <Truck className="w-3 h-3" />,
  "Plan Upgrade":         <TrendingUp className="w-3 h-3" />,
  "Waste Bag Order":      <ShoppingBag className="w-3 h-3" />,
  "Support":              <HeadphonesIcon className="w-3 h-3" />,
}

async function fetchAllCustomers(): Promise<CustomerRecord[]> {
  // phone → { name, address, lastDate, serviceCounts }
  const map = new Map<string, {
    name: string
    address: string
    lastRequestDate: Date
    serviceCounts: Map<string, number>
  }>()

  await Promise.all(
    SERVICE_COLLECTIONS.map(async ({ col, label }) => {
      const snap = await getDocs(collection(db, col))
      snap.docs.forEach((d) => {
        const data = d.data()
        const phone: string = data.customerPhone ?? ""
        if (!phone) return

        const date = parseDate(data.createdAt)
        const address: string = data.address ?? data.deliveryAddress ?? ""
        const name: string = data.customerName ?? ""

        if (map.has(phone)) {
          const existing = map.get(phone)!
          if (date > existing.lastRequestDate) existing.lastRequestDate = date
          if (!existing.name && name) existing.name = name
          if (!existing.address && address) existing.address = address
          // increment count for this service
          existing.serviceCounts.set(label, (existing.serviceCounts.get(label) ?? 0) + 1)
        } else {
          const serviceCounts = new Map<string, number>()
          serviceCounts.set(label, 1)
          map.set(phone, { name, address, lastRequestDate: date, serviceCounts })
        }
      })
    })
  )

  return Array.from(map.entries())
    .map(([phoneNumber, val]) => {
      const services: ServiceCount[] = Array.from(val.serviceCounts.entries()).map(
        ([label, count]) => ({ label, count })
      )
      const totalRequests = services.reduce((sum, s) => sum + s.count, 0)
      return {
        phoneNumber,
        name: val.name,
        address: val.address,
        totalRequests,
        lastRequestDate: val.lastRequestDate,
        services,
      }
    })
    .sort((a, b) => b.lastRequestDate.getTime() - a.lastRequestDate.getTime())
}

interface UsersTableProps {
  searchQuery?: string
}

export function UsersTable({ searchQuery = "" }: UsersTableProps) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
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
    fetchAllCustomers()
      .then((data) => { setCustomers(data); setIsLoading(false) })
      .catch((err) => { setError(err.message); setIsLoading(false) })
  }, [])

  const filtered = customers.filter((c) => {
    const q = filters.searchQuery.toLowerCase()
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.phoneNumber.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q)
    )
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent><div className="h-32 bg-muted animate-pulse rounded" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>All Customers</CardTitle></CardHeader>
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

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-8 text-center text-red-500">
          <p className="font-medium">Failed to load customers</p>
          <p className="text-sm mt-1 text-red-400">{error}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <AdvancedFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableStatuses={[]}
        availableWasteTypes={[]}
        showDateFilter={true}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-gray-600" />
            <span>
              All Customers ({filtered.length}
              {filtered.length !== customers.length && ` of ${customers.length}`})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Services Used</TableHead>
                <TableHead>Total Requests</TableHead>
                <TableHead>Last Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer.phoneNumber}>

                  {/* Name + avatar */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                        <span className="text-green-700 text-sm font-semibold">
                          {customer.name.charAt(0).toUpperCase() || "?"}
                        </span>
                      </div>
                      <span className="font-medium capitalize">{customer.name || "Unknown"}</span>
                    </div>
                  </TableCell>

                  {/* Phone + WhatsApp button */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">{cleanPhone(customer.phoneNumber)}</span>
                      </div>
                      <a
                        href={toWhatsAppLink(customer.phoneNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5d] transition-colors w-fit"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white shrink-0" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        Message
                      </a>
                    </div>
                  </TableCell>

                  {/* Address */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm max-w-[180px] truncate capitalize">
                        {customer.address || "—"}
                      </span>
                    </div>
                  </TableCell>

                  {/* Services used — badge with icon + count */}
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {customer.services.map(({ label, count }) => (
                        <Badge
                          key={label}
                          className={`text-xs flex items-center gap-1 pr-1 ${SERVICE_BADGE[label] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {SERVICE_ICON[label]}
                          <span>{label}</span>
                          {/* count pill */}
                          <span className="ml-1 bg-white/60 text-current rounded-full px-1.5 py-0 text-[10px] font-bold leading-4">
                            {count}
                          </span>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>

                  {/* Total requests */}
                  <TableCell>
                    <Badge variant="secondary" className="font-semibold">
                      {customer.totalRequests}
                    </Badge>
                  </TableCell>

                  {/* Last active */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">
                        {customer.lastRequestDate.getTime() === 0
                          ? "—"
                          : customer.lastRequestDate.toLocaleDateString("en-NG", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                      </span>
                    </div>
                  </TableCell>

                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {filters.searchQuery ? "No customers match your search." : "No customers found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}