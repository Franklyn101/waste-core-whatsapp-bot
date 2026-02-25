"use client"

import { useMemo } from "react"
import type { WasteRequest, UserData } from "@/lib/types"
import type { FilterOptions } from "@/components/advanced-filters"

export function useFilteredRequests(requests: WasteRequest[], filters: FilterOptions): WasteRequest[] {
  return useMemo(() => {
    return requests.filter((request) => {
      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        const matchesSearch =
          request.name.toLowerCase().includes(query) ||
          request.phoneNumber.includes(query) ||
          request.address.toLowerCase().includes(query) ||
          request.wasteType.toLowerCase().includes(query)

        if (!matchesSearch) return false
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(request.status)) {
        return false
      }

      // Waste type filter
      if (filters.wasteTypes.length > 0 && !filters.wasteTypes.includes(request.wasteType)) {
        return false
      }

      // Date range filter
      if (filters.dateRange.from || filters.dateRange.to) {
        const requestDate = new Date(request.createdAt)
        requestDate.setHours(0, 0, 0, 0)

        if (filters.dateRange.from) {
          const fromDate = new Date(filters.dateRange.from)
          fromDate.setHours(0, 0, 0, 0)
          if (requestDate < fromDate) return false
        }

        if (filters.dateRange.to) {
          const toDate = new Date(filters.dateRange.to)
          toDate.setHours(23, 59, 59, 999)
          if (requestDate > toDate) return false
        }
      }

      return true
    })
  }, [requests, filters])
}

export function useFilteredUsers(users: UserData[], filters: FilterOptions): UserData[] {
  return useMemo(() => {
    return users.filter((user) => {
      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        const matchesSearch =
          user.name.toLowerCase().includes(query) ||
          user.phoneNumber.includes(query) ||
          user.address.toLowerCase().includes(query)

        if (!matchesSearch) return false
      }

      // Date range filter for last request date
      if (filters.dateRange.from || filters.dateRange.to) {
        const lastRequestDate = new Date(user.lastRequestDate)
        lastRequestDate.setHours(0, 0, 0, 0)

        if (filters.dateRange.from) {
          const fromDate = new Date(filters.dateRange.from)
          fromDate.setHours(0, 0, 0, 0)
          if (lastRequestDate < fromDate) return false
        }

        if (filters.dateRange.to) {
          const toDate = new Date(filters.dateRange.to)
          toDate.setHours(23, 59, 59, 999)
          if (lastRequestDate > toDate) return false
        }
      }

      return true
    })
  }, [users, filters])
}
