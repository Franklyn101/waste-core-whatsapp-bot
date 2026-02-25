"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, AlertCircle } from "lucide-react"

export function LocalTestingPanel() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking")
  const [firebaseStatus, setFirebaseStatus] = useState<"checking" | "connected" | "error">("checking")

  const checkBackendStatus = async () => {
    setBackendStatus("checking")
    try {
      const response = await fetch("http://localhost:3001/health")
      if (response.ok) {
        setBackendStatus("online")
      } else {
        setBackendStatus("offline")
      }
    } catch (error) {
      setBackendStatus("offline")
    }
  }

  const checkFirebaseStatus = async () => {
    setFirebaseStatus("checking")
    try {
      // This will be handled by your Firebase service
      const { getFirebaseStats } = await import("@/lib/firebase-service")
      await getFirebaseStats()
      setFirebaseStatus("connected")
    } catch (error) {
      setFirebaseStatus("error")
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online":
      case "connected":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "offline":
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variant =
      status === "online" || status === "connected"
        ? "default"
        : status === "offline" || status === "error"
          ? "destructive"
          : "secondary"
    return <Badge variant={variant}>{status}</Badge>
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Local Development Status</CardTitle>
        <CardDescription>Check the connection status of your local services</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(backendStatus)}
            <span>WhatsApp Bot Server (Port 3001)</span>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(backendStatus)}
            <Button size="sm" variant="outline" onClick={checkBackendStatus}>
              Check
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(firebaseStatus)}
            <span>Firebase Connection</span>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(firebaseStatus)}
            <Button size="sm" variant="outline" onClick={checkFirebaseStatus}>
              Check
            </Button>
          </div>
        </div>

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Quick Setup Commands:</h4>
          <div className="space-y-2 text-sm font-mono bg-muted p-3 rounded">
            <div># Start Backend Server</div>
            <div>cd whatsapp-bot-server && npm run dev</div>
            <div className="mt-2"># Start Frontend Dashboard</div>
            <div>npm run dev</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
