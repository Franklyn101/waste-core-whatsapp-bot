"use client"

import { useState, useEffect } from "react"
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  MoreHorizontal, Clock, Wifi, WifiOff,
  HeadphonesIcon, MessageSquare, Tag, Eye,
} from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredRequests } from "@/hooks/use-filtered-data"
import { collection, query, limit, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { FirebaseService } from "@/lib/firebase-service"
import type { SupportTicket } from "@/lib/types"

interface SupportTicketsTableProps {
  searchQuery?: string
}

const STATUS_BADGE: Record<string, string> = {
  open:        "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved:    "bg-green-100 text-green-800",
  closed:      "bg-gray-100 text-gray-700",
}

const CATEGORY_BADGE: Record<string, string> = {
  "Missed Pickup":      "bg-orange-100 text-orange-800",
  "Billing Issue":      "bg-yellow-100 text-yellow-800",
  "Driver Complaint":   "bg-red-100 text-red-800",
  "Change Pickup Date": "bg-blue-100 text-blue-800",
  "Other":              "bg-gray-100 text-gray-700",
}

// Suggested quick-reply templates per category
const QUICK_REPLIES: Record<string, string> = {
  "Missed Pickup":
    "Hello {name}, we sincerely apologise for the missed pickup. Our team is looking into this and will reschedule your pickup as soon as possible. Thank you for your patience.",
  "Billing Issue":
    "Hello {name}, thank you for reaching out about your billing concern. Our team is reviewing your account and will get back to you shortly.",
  "Driver Complaint":
    "Hello {name}, we are sorry to hear about your experience. We take driver conduct very seriously and will investigate this immediately.",
  "Change Pickup Date":
    "Hello {name}, we have received your request to change your pickup date. Kindly let us know your preferred new date and we will update it for you.",
  "Other":
    "Hello {name}, thank you for contacting WasteCore support. We have received your message and our team will respond to you shortly.",
}

function parseDate(value: any): Date {
  if (!value) return new Date()
  if (typeof value === "string") return new Date(value)
  if (value?.toDate) return value.toDate()
  if (value instanceof Date) return value
  return new Date()
}

// Strip "whatsapp:" prefix and format for wa.me link
function toWhatsAppNumber(phone: string): string {
  return phone.replace("whatsapp:", "").replace(/\s+/g, "").replace(/^\+/, "")
}

function buildWhatsAppLink(phone: string, message: string): string {
  const number = toWhatsAppNumber(phone)
  const encoded = encodeURIComponent(message)
  return `https://wa.me/${number}?text=${encoded}`
}

export function SupportTicketsTable({ searchQuery = "" }: SupportTicketsTableProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
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
    setError(null)

    const q = query(collection(db, "supportTickets"), limit(100))
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const raw = snapshot.docs.map((d) => {
          const data = d.data()
          return {
            id:            d.id,
            ticketId:      data.ticketId ?? d.id,
            customerName:  data.customerName ?? "",
            customerPhone: data.customerPhone ?? "",
            category:      data.category ?? "Other",
            message:       data.message ?? "",
            contactTime:   data.contactTime ?? "",
            status:        data.status ?? "open",
            createdAt:     parseDate(data.createdAt),
            updatedAt:     parseDate(data.updatedAt || data.createdAt),
          } as SupportTicket
        })
        setTickets([...raw].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))
        setIsLoading(false)
        setIsConnected(true)
      },
      (err) => {
        setError(`${err.code}: ${err.message}`)
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

  const filteredTickets = useFilteredRequests(tickets as any, filters) as unknown as SupportTicket[]
  const availableStatuses   = Array.from(new Set(tickets.map((t) => t.status)))
  const availableCategories = Array.from(new Set(tickets.map((t) => t.category)))

  const handleStatusUpdate = async (ticketId: string, newStatus: string) => {
    const ok = await FirebaseService.updateSupportTicketStatus(ticketId, newStatus)
    if (!ok) alert("Failed to update ticket status")
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent><div className="h-32 bg-muted animate-pulse rounded" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Support Tickets</CardTitle></CardHeader>
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
          <HeadphonesIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">Failed to load support tickets</p>
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
        availableStatuses={availableStatuses}
        availableWasteTypes={availableCategories}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeadphonesIcon className="w-5 h-5 text-purple-600" />
              <span>
                Support Tickets ({filteredTickets.length}
                {filteredTickets.length !== tickets.length && ` of ${tickets.length}`})
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
                <TableHead>Ticket ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Contact Time</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTickets.map((ticket) => {
                const quickReply = (QUICK_REPLIES[ticket.category] ?? QUICK_REPLIES["Other"])
                  .replace("{name}", ticket.customerName)
                const waLink = buildWhatsAppLink(ticket.customerPhone, quickReply)
                const rawNumber = toWhatsAppNumber(ticket.customerPhone)

                return (
                  <TableRow key={ticket.id}>

                    {/* Ticket ID */}
                    <TableCell>
                      <span className="text-xs font-mono font-semibold text-purple-700">
                        {ticket.ticketId}
                      </span>
                    </TableCell>

                    {/* Customer name */}
                    <TableCell className="font-medium whitespace-nowrap">
                      {ticket.customerName}
                    </TableCell>

                    {/* WhatsApp number + message button */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500 font-mono">+{rawNumber}</span>
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5d] transition-colors w-fit"
                        >
                          {/* WhatsApp SVG icon */}
                          <svg
                            viewBox="0 0 24 24"
                            className="w-3.5 h-3.5 fill-white shrink-0"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          Message
                        </a>
                      </div>
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <Badge className={CATEGORY_BADGE[ticket.category] ?? "bg-gray-100 text-gray-700"}>
                        <Tag className="w-3 h-3 mr-1" />
                        {ticket.category}
                      </Badge>
                    </TableCell>

                    {/* Message preview + full view modal */}
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate text-gray-600 max-w-[140px]">
                          {ticket.message}
                        </span>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="shrink-0 h-6 px-2">
                              <Eye className="w-3 h-3" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-purple-600" />
                                Ticket {ticket.ticketId}
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 text-sm">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Customer</p>
                                  <p className="font-medium">{ticket.customerName}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">WhatsApp</p>
                                  <p className="font-mono text-sm">+{rawNumber}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Category</p>
                                  <Badge className={CATEGORY_BADGE[ticket.category] ?? "bg-gray-100 text-gray-700"}>
                                    {ticket.category}
                                  </Badge>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                                  <Badge className={STATUS_BADGE[ticket.status] ?? STATUS_BADGE.open}>
                                    {ticket.status.replace("_", " ")}
                                  </Badge>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Contact Time</p>
                                  <p className="font-medium capitalize">{ticket.contactTime || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Date Raised</p>
                                  <p className="font-medium">
                                    {ticket.createdAt.toLocaleDateString("en-NG", {
                                      day: "numeric", month: "short", year: "numeric",
                                    })}
                                  </p>
                                </div>
                              </div>

                              {/* Full message */}
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Full Message</p>
                                <div className="bg-muted rounded-lg p-3 leading-relaxed">
                                  {ticket.message || "No message provided."}
                                </div>
                              </div>

                              {/* Quick reply preview + send button */}
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Quick Reply (pre-filled)</p>
                                <div className="bg-[#dcf8c6] rounded-lg p-3 leading-relaxed text-gray-800 text-xs">
                                  {quickReply}
                                </div>
                                <a
                                  href={waLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-3 inline-flex items-center gap-2 w-full justify-center px-4 py-2 rounded-lg bg-[#25D366] text-white font-medium text-sm hover:bg-[#1ebe5d] transition-colors"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="w-4 h-4 fill-white shrink-0"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                  </svg>
                                  Open WhatsApp to Send Reply
                                </a>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>

                    {/* Contact time */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="text-sm capitalize">{ticket.contactTime || "—"}</span>
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {ticket.createdAt.toLocaleDateString("en-NG", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </span>
                    </TableCell>

                    {/* Status badge */}
                    <TableCell>
                      <Badge className={STATUS_BADGE[ticket.status] ?? STATUS_BADGE.open}>
                        {ticket.status.replace("_", " ")}
                      </Badge>
                    </TableCell>

                    {/* Actions dropdown */}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {ticket.status === "open" && (
                            <DropdownMenuItem onClick={() => handleStatusUpdate(ticket.id, "in_progress")}>
                              Mark In Progress
                            </DropdownMenuItem>
                          )}
                          {ticket.status === "in_progress" && (
                            <DropdownMenuItem onClick={() => handleStatusUpdate(ticket.id, "resolved")}>
                              Mark Resolved
                            </DropdownMenuItem>
                          )}
                          {ticket.status === "resolved" && (
                            <DropdownMenuItem onClick={() => handleStatusUpdate(ticket.id, "closed")}>
                              Close Ticket
                            </DropdownMenuItem>
                          )}
                          {ticket.status !== "open" && (
                            <DropdownMenuItem onClick={() => handleStatusUpdate(ticket.id, "open")}>
                              Reopen Ticket
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>

                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {filteredTickets.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <HeadphonesIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {filters.searchQuery || filters.status.length > 0 || filters.wasteTypes.length > 0
                ? "No tickets match your filters."
                : "No support tickets found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}