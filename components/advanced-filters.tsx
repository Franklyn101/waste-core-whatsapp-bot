"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon, Filter, X, RotateCcw } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export interface FilterOptions {
  status: string[]
  wasteTypes: string[]
  dateRange: {
    from: Date | null
    to: Date | null
  }
  searchQuery: string
}

interface AdvancedFiltersProps {
  filters: FilterOptions
  onFiltersChange: (filters: FilterOptions) => void
  availableStatuses?: string[]
  availableWasteTypes?: string[]
  showDateFilter?: boolean
}

// 🔹 Make default statuses match your Firestore values
const DEFAULT_STATUSES = ["pending", "confirmed", "completed", "cancelled"]
// 🔹 Make default waste types match Firestore
const DEFAULT_WASTE_TYPES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Electronic", "Mixed"]

export function AdvancedFilters({
  filters,
  onFiltersChange,
  availableStatuses = DEFAULT_STATUSES,
  availableWasteTypes = DEFAULT_WASTE_TYPES,
  showDateFilter = true,
}: AdvancedFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const updateFilters = (updates: Partial<FilterOptions>) => {
    onFiltersChange({ ...filters, ...updates })
  }

  const addStatus = (status: string) => {
    if (!filters.status.includes(status)) {
      updateFilters({ status: [...filters.status, status] })
    }
  }

  const removeStatus = (status: string) => {
    updateFilters({ status: filters.status.filter((s) => s !== status) })
  }

  const addWasteType = (wasteType: string) => {
    if (!filters.wasteTypes.includes(wasteType)) {
      updateFilters({ wasteTypes: [...filters.wasteTypes, wasteType] })
    }
  }

  const removeWasteType = (wasteType: string) => {
    updateFilters({ wasteTypes: filters.wasteTypes.filter((w) => w !== wasteType) })
  }

  const clearAllFilters = () => {
    updateFilters({
      status: [],
      wasteTypes: [],
      dateRange: { from: null, to: null },
      searchQuery: "",
    })
  }

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.wasteTypes.length > 0 ||
    filters.dateRange.from ||
    filters.dateRange.to ||
    filters.searchQuery.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            <span>Filters</span>
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-2">
                {filters.status.length +
                  filters.wasteTypes.length +
                  (filters.dateRange.from ? 1 : 0) +
                  (filters.dateRange.to ? 1 : 0)}{" "}
                active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? "Collapse" : "Expand"}
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Query */}
        <div className="space-y-2">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            placeholder="Search by name, phone, address, or waste type..."
            value={filters.searchQuery}
            onChange={(e) => updateFilters({ searchQuery: e.target.value })}
          />
        </div>

        {isExpanded && (
          <>
            {/* Status Filter */}
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {filters.status.map((status) => (
                  <Badge key={status} variant="default" className="flex items-center gap-1">
                    {status}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeStatus(status)} />
                  </Badge>
                ))}
              </div>
              <Select onValueChange={addStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Add status filter..." />
                </SelectTrigger>
                <SelectContent>
                  {availableStatuses
                    .filter((status) => !filters.status.includes(status))
                    .map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Waste Type Filter */}
            <div className="space-y-2">
              <Label>Waste Types</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {filters.wasteTypes.map((wasteType) => (
                  <Badge key={wasteType} variant="secondary" className="flex items-center gap-1">
                    {wasteType}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeWasteType(wasteType)} />
                  </Badge>
                ))}
              </div>
              <Select onValueChange={addWasteType}>
                <SelectTrigger>
                  <SelectValue placeholder="Add waste type filter..." />
                </SelectTrigger>
                <SelectContent>
                  {availableWasteTypes
                    .filter((wasteType) => !filters.wasteTypes.includes(wasteType))
                    .map((wasteType) => (
                      <SelectItem key={wasteType} value={wasteType}>
                        {wasteType}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range Filter */}
            {showDateFilter && (
              <div className="space-y-2">
                <Label>Date Range</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
                          !filters.dateRange.from && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.dateRange.from ? format(filters.dateRange.from, "PPP") : "From date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.dateRange.from || undefined}
                        onSelect={(date) => updateFilters({ dateRange: { ...filters.dateRange, from: date || null } })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
                          !filters.dateRange.to && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.dateRange.to ? format(filters.dateRange.to, "PPP") : "To date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.dateRange.to || undefined}
                        onSelect={(date) => updateFilters({ dateRange: { ...filters.dateRange, to: date || null } })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
