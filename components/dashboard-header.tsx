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
import { Bell, LogOut, Menu, Search, Settings } from "lucide-react"
import { useAdminAuth } from "@/lib/admin-auth"

interface DashboardHeaderProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onMenuClick?: () => void
}

export function DashboardHeader({ searchQuery, onSearchChange, onMenuClick }: DashboardHeaderProps) {
  const { profile, signOut } = useAdminAuth()
  const initials = (profile?.username ?? "ad").slice(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 px-3 py-3 md:gap-4 md:px-6 md:py-4 bg-background border-b border-border">
      {/* Menu button: phones only (the sidebar is a drawer there) */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden shrink-0"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Search Bar */}
      <div className="flex-1 min-w-0 md:max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-muted/50"
          />
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center gap-1 md:gap-4 shrink-0 md:ml-auto">
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex text-muted-foreground">
          <Bell className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex text-muted-foreground">
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
