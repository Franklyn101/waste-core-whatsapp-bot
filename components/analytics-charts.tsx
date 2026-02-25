"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { FirebaseService } from "@/lib/firebase-service"
import type { WasteRequest } from "@/lib/types"

export function AnalyticsCharts() {
  const [requests, setRequests] = useState<WasteRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        const data = await FirebaseService.getPickupRequests(1000)
        setRequests(data)
      } catch (error) {
        console.error("Error loading analytics data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Process data for charts
  const getWeeklyData = () => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - i)
      return date.toISOString().split("T")[0]
    }).reverse()

    return last7Days.map((date) => {
      const dayRequests = requests.filter(
        (req) => req.createdAt.toISOString().split("T")[0] === date,
      )
      return {
        date: new Date(date).toLocaleDateString("en-US", { weekday: "short" }),
        requests: dayRequests.length,
      }
    })
  }

  const getWasteTypeData = () => {
    const wasteTypes = requests.reduce<Record<string, number>>((acc, req) => {
      const type = req.wasteType || "Unknown"
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {})

    return Object.entries(wasteTypes).map(([name, value]) => ({ name, value }))
  }

  const getStatusData = () => {
    const statuses = requests.reduce<Record<string, number>>((acc, req) => {
      const status = req.status || "pending"
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})

    return Object.entries(statuses).map(([name, value]) => ({ name, value }))
  }

  const COLORS = ["#0891b2", "#f59e0b", "#1f2937", "#8b5cf6", "#dc2626"]

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle>
                <div className="h-5 bg-muted animate-pulse rounded w-32" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Weekly Requests */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={getWeeklyData()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="requests" fill="hsl(var(--chart-1))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Waste Types Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Waste Types Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={getWasteTypeData()}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {getWasteTypeData().map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Request Status */}
      <Card>
        <CardHeader>
          <CardTitle>Request Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={getStatusData()}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {getStatusData().map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {requests.slice(0, 5).map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div>
                  <p className="font-medium">{request.customerName}</p>
                  <p className="text-sm text-muted-foreground">{request.wasteType} pickup</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{request.status}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.createdAt.toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
