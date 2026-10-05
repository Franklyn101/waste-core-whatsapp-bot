"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Bell, LogOut, Search, Settings } from "lucide-react"
import { useAdminAuth } from "@/lib/admin-auth"

interface DashboardHeaderProps {
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function DashboardHeader({ searchQuery, onSearchChange }: DashboardHeaderProps) {
  const { profile, signOut } = useAdminAuth()
  const initials = (profile?.username ?? "ad").slice(0, 2).toUpperCase()

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-background border-b border-border">
      {/* Search Bar */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search requests, users, or phone numbers..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-muted/50"
          />
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Bell className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Settings className="w-5 h-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded-full" aria-label="Account menu">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="font-medium">{profile?.username}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {profile?.role === "main" ? "Main admin" : "Sub-admin"}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
