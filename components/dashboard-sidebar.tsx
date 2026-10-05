"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Truck, Ticket, Rocket, Trash, Zap, Users, Receipt, BarChart3, Menu, X, HardHat } from "lucide-react"

interface SidebarProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

const navigationItems = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
  },
  {
    id: "pickup-requests",
    label: "Pickup Requests",
    icon: Truck,
  },
  {
    id: "users",
    label: "User Data",
    icon: Users,
  },
  {
    id: "instant-pickups",
    label: "Instant Pickups",
    icon: Zap,
  },

  {
    id: "collectors",
    label: "Collectors",
    icon: HardHat,
  },
  {
    id: "waste-bag-orders",
    label: "Waste Bag Orders",
    icon:  Trash,
  },
  {
    id: "upgrade-plans",
    label: "Upgrade Plans",
    icon: Rocket,
  },

  {
    id: "payments",
    label: "Payment Receipts",
    icon: Receipt,
  },
  {
    id: "support-tickets",
    label: "Support Tickets",
    icon: Ticket,

  },
  {
    id: "analytics",
    label: "Service Analytics",
    icon: BarChart3,
  },
]

export function DashboardSidebar({ activeSection, onSectionChange }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div
      className={cn(
        "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground">Waste Connect</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {isCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id

            return (
              <li key={item.id}>
                <Button
                  variant={isActive ? "default" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-3 text-left",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isCollapsed && "justify-center px-2",
                  )}
                  onClick={() => onSectionChange(item.id)}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!isCollapsed && <span>{item.label}</span>}
                </Button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
