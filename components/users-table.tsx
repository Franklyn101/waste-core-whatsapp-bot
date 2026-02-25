"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Phone, MapPin, Calendar, User } from "lucide-react"
import { AdvancedFilters, type FilterOptions } from "@/components/advanced-filters"
import { useFilteredUsers } from "@/hooks/use-filtered-data"
import { FirebaseService } from "@/lib/firebase-service"
import type { UserData } from "@/lib/types"

interface UsersTableProps {
  searchQuery?: string
}

export function UsersTable({ searchQuery = "" }: UsersTableProps) {
  const [users, setUsers] = useState<UserData[]>([])
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

  useEffect(() => {
    const loadUsers = async () => {
      setIsLoading(true)
      try {
        const data = await FirebaseService.getUsersData()
        setUsers(data)
      } catch (error) {
        console.error("Error loading users:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadUsers()
  }, [])

  const filteredUsers = useFilteredUsers(users, filters)

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
            <CardTitle>User Data</CardTitle>
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
        availableStatuses={[]}
        availableWasteTypes={[]}
        showDateFilter={true}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            User Data ({filteredUsers.length}
            {filteredUsers.length !== users.length && ` of ${users.length}`} customers)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Total Requests</TableHead>
                <TableHead>Last Request</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.phoneNumber}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="font-medium">{user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{user.phoneNumber}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm max-w-xs truncate">{user.address}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.totalRequests} requests</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{user.lastRequestDate.toLocaleDateString()}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredUsers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {filters.searchQuery || filters.dateRange.from || filters.dateRange.to
                ? "No users match your filters."
                : "No user data found."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
