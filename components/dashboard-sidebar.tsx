"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { LayoutDashboard, Truck, Ticket, Rocket, Trash, Zap, Users, Receipt, BarChart3, Menu, X, HardHat, UserCog } from "lucide-react"

interface SidebarProps {
  activeSection: string
  onSectionChange: (section: string) => void
  isMainAdmin?: boolean
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
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

// Shown only to the main admin.
const mainAdminItems = [
  {
    id: "sub-admins",
    label: "Sub-admins",
    icon: UserCog,
  },
]

export function DashboardSidebar({
  activeSection,
  onSectionChange,
  isMainAdmin = false,
  mobileOpen = false,
  onMobileOpenChange,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const items = [...navigationItems, ...(isMainAdmin ? mainAdminItems : [])]

  // On phones, picking a page also closes the drawer.
  const selectFromDrawer = (section: string) => {
    onSectionChange(section)
    onMobileOpenChange?.(false)
  }

  return (
    <>
      {/* Desktop / tablet: fixed, collapsible sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
          isCollapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          {!isCollapsed && <Brand />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </Button>
        </div>
        <NavList items={items} activeSection={activeSection} onSelect={onSectionChange} collapsed={isCollapsed} />
      </aside>

      {/* Phones: slide-in drawer opened from the header menu button */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 bg-sidebar p-0 md:hidden">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle asChild>
              <div><Brand /></div>
            </SheetTitle>
            <SheetDescription className="sr-only">Dashboard navigation</SheetDescription>
          </SheetHeader>
          <NavList items={items} activeSection={activeSection} onSelect={selectFromDrawer} />
        </SheetContent>
      </Sheet>
    </>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
        <Truck className="w-5 h-5 text-primary-foreground" />
      </div>
      <span className="font-semibold text-sidebar-foreground">WasteCore</span>
    </div>
  )
}

function NavList({
  items,
  activeSection,
  onSelect,
  collapsed = false,
}: {
  items: typeof navigationItems
  activeSection: string
  onSelect: (section: string) => void
  collapsed?: boolean
}) {
  return (
    <nav className="flex-1 overflow-y-auto p-2">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <li key={item.id}>
              <Button
                variant={isActive ? "default" : "ghost"}
                className={cn(
                  "w-full justify-start gap-3 text-left h-11 md:h-9",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-2",
                )}
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
