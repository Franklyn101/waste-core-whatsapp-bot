"use client"

import { useState, useEffect, useRef } from "react"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardStatsCards } from "@/components/dashboard-stats"
import { PickupRequestsTable } from "@/components/pickup-requests-table"
import { PaymentReceiptsGallery } from "@/components/payment-receipts-gallery"
import { AnalyticsCharts } from "@/components/analytics-charts"
import { LocalTestingPanel } from "@/components/local-testing-panel"
import { FirebaseService } from "@/lib/firebase-service"
import type { DashboardStats } from "@/lib/types"
import { InstantPickupTable } from "@/components/instant-pickup"
import  {WasteBagOrdersTable }  from "@/components/waste-bag-orders"
import { UpgradeRequestsTable } from "@/components/upgrade-request-table"
import { SupportTicketsTable } from "@/components/support-ticket-table"
import { CollectorsManager } from "@/components/collectors-manager"
import { SubAdminsManager } from "@/components/sub-admins-manager"
import { SubscriptionsManager } from "@/components/subscriptions-manager"
import { AdminGate } from "@/components/admin-login"
import { AdminAuthProvider, useAdminAuth } from "@/lib/admin-auth"
import { Toaster } from "@/components/ui/sonner"
import { RevenueReports } from "@/components/revenue-reports"
import { ActivityLog } from "@/components/activity-log"
import { CustomersManager } from "@/components/customers-manager"
import { BroadcastsManager } from "@/components/broadcasts-manager"
import { BackupsManager } from "@/components/backups-manager"
import { can } from "@/lib/permissions"


export default function AdminPage() {
  return (
    <AdminAuthProvider>
      <AdminGate>
        <DashboardPage />
      </AdminGate>
    </AdminAuthProvider>
  )
}

function DashboardPage() {
  const { profile } = useAdminAuth()
  const isMainAdmin = profile?.role === "main"
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const [activeSection, setActiveSection] = useState("overview")
  const [searchQuery, setSearchQuery] = useState("")
  const [stats, setStats] = useState<DashboardStats>({
    totalRequests: 0,
    pendingRequests: 0,
    completedRequests: 0,
    todayRequests: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>()

  useEffect(() => {
    setIsLoading(true)
    console.log("Dashboard mounted")

    const unsubscribe = FirebaseService.subscribeToDashboardStats((newStats) => {
      setStats(newStats)
      setIsLoading(false)
      setLastUpdated(new Date())
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const renderMainContent = () => {
    switch (activeSection) {
      case "overview":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Dashboard Overview</h1>
              <p className="text-muted-foreground mt-2">
                Monitor your waste collection service performance and manage requests.
              </p>
            </div>
            <DashboardStatsCards stats={stats} isLoading={isLoading} lastUpdated={lastUpdated} />
            {process.env.NODE_ENV === "development" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">Development Tools</h2>
                <LocalTestingPanel />
              </div>
            )}
            <AnalyticsCharts />
          </div>
        )
      case "pickup-requests":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Scheduled Pickups</h1>
              <p className="text-muted-foreground mt-2">
                One-off pickups customers booked for a chosen date and time on WhatsApp.
              </p>
            </div>
            <PickupRequestsTable searchQuery={searchQuery} />
          </div>
        )
      case "users":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Customers</h1>
              <p className="text-muted-foreground mt-2">Every customer with their bookings, payments, tickets, ratings and your notes. Tap a customer for their full history.</p>
            </div>
            <CustomersManager searchQuery={searchQuery} />
          </div>
        )


        case "instant-pickups":
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Instant Pickups</h1>
        <p className="text-muted-foreground mt-2">
          Manage and track all instant pickup requests from WhatsApp.
        </p>
      </div>
      <InstantPickupTable searchQuery={searchQuery} />
    </div>
  )
  case "subscriptions":
    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Weekly and monthly pickup subscribers, their type of waste and pickup schedule.
        </p>
      </div>
      <SubscriptionsManager searchQuery={searchQuery} />
    </div>
  )
  case "collectors":
    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Collectors</h1>
        <p className="text-muted-foreground mt-2">
          Register collectors, assign pickups to them, and track pickup progress.
        </p>
      </div>
      <CollectorsManager searchQuery={searchQuery} />
    </div>
  )
  case "waste-bag-orders":
    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Waste Bag Orders</h1>
        <p className="text-muted-foreground mt-2">
          Manage and track all waste bag orders from WhatsApp.
        </p>
      </div>
      <WasteBagOrdersTable searchQuery={searchQuery} />
    </div>
  )

      case "upgrade-plans":
      return (
        <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Plan Requests</h1>
        <p className="text-muted-foreground mt-2">
          New monthly subscription requests (Business and Household) from WhatsApp.
        </p>
      </div>
      <UpgradeRequestsTable searchQuery={searchQuery} />
      </div>

      )
       case "support-tickets":
      return (
        <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">Support Tickets</h1>
        <p className="text-muted-foreground mt-2">
          Manage and track all support tickets from WhatsApp.
        </p>
      </div>
      <SupportTicketsTable searchQuery={searchQuery} />
      </div>

      )



      case "payments":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Payment Receipts</h1>
              <p className="text-muted-foreground mt-2">View and manage uploaded payment receipt images.</p>
            </div>
            <PaymentReceiptsGallery searchQuery={searchQuery} />
          </div>
        )
      case "analytics":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Service Analytics</h1>
              <p className="text-muted-foreground mt-2">Analyze service performance and trends over time.</p>
            </div>
            <AnalyticsCharts />
          </div>
        )
      case "reports":
        if (!can(profile, "viewRevenue")) return <div>You don&apos;t have access to revenue reports. Ask the main admin.</div>
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Revenue Reports</h1>
              <p className="text-muted-foreground mt-2">
                Income from Paystack, verified bank transfers and recorded payments, by period, service and method.
              </p>
            </div>
            <RevenueReports />
          </div>
        )
      case "broadcasts":
        if (!can(profile, "sendBroadcasts")) return <div>You don&apos;t have access to broadcasts. Ask the main admin.</div>
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Broadcasts</h1>
              <p className="text-muted-foreground mt-2">Send an announcement to a group of customers on WhatsApp: holidays, schedule changes, offers.</p>
            </div>
            <BroadcastsManager />
          </div>
        )
      case "backups":
        if (!isMainAdmin) return <div>Only the main admin can manage backups.</div>
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Backups</h1>
              <p className="text-muted-foreground mt-2">Nightly copies of the whole database, so nothing is lost if something goes wrong.</p>
            </div>
            <BackupsManager />
          </div>
        )
      case "activity":
        if (!isMainAdmin) return <div>Only the main admin can see the activity log.</div>
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Activity Log</h1>
              <p className="text-muted-foreground mt-2">Who did what on the dashboard: status changes, payments, assignments and more.</p>
            </div>
            <ActivityLog searchQuery={searchQuery} />
          </div>
        )
      case "sub-admins":
        if (!isMainAdmin) return <div>Only the main admin can manage sub-admins.</div>
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-balance">Sub-admins</h1>
              <p className="text-muted-foreground mt-2">
                Create staff logins, reset their passwords, and turn access on or off.
              </p>
            </div>
            <SubAdminsManager />
          </div>
        )
      default:
        return <div>Section not found</div>
    }
  }

  // New page: close the phone drawer and start at the top.
  const changeSection = (section: string) => {
    setActiveSection(section)
    setMobileNavOpen(false)
    mainRef.current?.scrollTo({ top: 0 })
  }

  // Tapping a push notification opens /admin?section=..., or (if the
  // dashboard is already open) the service worker asks it to switch page.
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section")
    if (section) {
      setActiveSection(section)
      window.history.replaceState(null, "", window.location.pathname)
    }
    if (!("serviceWorker" in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "open-section" && typeof event.data.section === "string") {
        setActiveSection(event.data.section)
        setMobileNavOpen(false)
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [])

  return (
    <div className="flex h-dvh bg-background">
      {/* Sidebar (fixed on desktop, drawer on phones) */}
      <DashboardSidebar
        activeSection={activeSection}
        onSectionChange={changeSection}
        isMainAdmin={isMainAdmin}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <DashboardHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onMenuClick={() => setMobileNavOpen(true)}
          onNavigate={changeSection}
        />

        {/* Main Content Area */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-6">{renderMainContent()}</main>
      </div>
      <Toaster position="top-right" closeButton />
    </div>
  )
}
