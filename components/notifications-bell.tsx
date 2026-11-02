"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore"
import { toast } from "sonner"
import {
  Bell,
  BellOff,
  BellRing,
  ClipboardCheck,
  CreditCard,
  LifeBuoy,
  Package,
  RefreshCw,
  Truck,
  Volume2,
  VolumeX,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { db } from "@/lib/firebase"
import { useAdminAuth } from "@/lib/admin-auth"

interface AdminNotification {
  id: string
  type: string
  title: string
  body: string
  section: string
  createdAt: string
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  booking: Truck,
  subscription: RefreshCw,
  order: Package,
  support: LifeBuoy,
  payment: CreditCard,
  collector: ClipboardCheck,
  renewal: RefreshCw,
}

// Browser storage can be unavailable (private mode); fall back quietly.
function readStore(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" })
}

// Short two-tone chime, made in the browser (no sound file needed).
function chime() {
  try {
    const ctx = new AudioContext()
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.15 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.15)
      osc.stop(ctx.currentTime + i * 0.15 + 0.3)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch { /* sound not available */ }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

type PushState = "unsupported" | "ios-install" | "blocked" | "off" | "on" | "working"

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true
}

interface NotificationsBellProps {
  onNavigate: (section: string) => void
}

export function NotificationsBell({ onNavigate }: NotificationsBellProps) {
  const { profile, authFetch } = useAdminAuth()
  const uid = profile?.uid ?? "admin"
  const seenKey = `wc-notifications-seen-${uid}`
  const soundKey = `wc-notifications-sound-${uid}`

  const [items, setItems] = useState<AdminNotification[]>([])
  const [lastSeen, setLastSeen] = useState<string>("")
  const [sound, setSound] = useState(true)
  const [pushState, setPushState] = useState<PushState>("off")
  const [pushMessage, setPushMessage] = useState<string | null>(null)
  const firstLoad = useRef(true)
  const knownIds = useRef(new Set<string>())
  // Kept in a ref so the live listener isn't restarted on every render.
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate

  useEffect(() => {
    setLastSeen(readStore(seenKey) ?? new Date().toISOString())
    setSound(readStore(soundKey) !== "off")
  }, [seenKey, soundKey])

  // Live list of the latest notifications; new ones also pop up as toasts.
  useEffect(() => {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(30))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminNotification, "id">) }))
      if (!firstLoad.current) {
        const fresh = list.filter((n) => !knownIds.current.has(n.id))
        fresh.slice(0, 3).forEach((n) => {
          toast(n.title, { description: n.body, action: { label: "Open", onClick: () => navigate.current(n.section) } })
        })
        if (fresh.length && readStore(soundKey) !== "off") chime()
      }
      firstLoad.current = false
      knownIds.current = new Set(list.map((n) => n.id))
      setItems(list)
    }, (err) => console.error("notifications error:", err))
  }, [soundKey])

  // ── Push on this device ─────────────────────────────────────────────────
  const refreshPushState = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushState(isIos() && !isStandalone() ? "ios-install" : "unsupported")
      return
    }
    if (Notification.permission === "denied") return setPushState("blocked")
    const reg = await navigator.serviceWorker.getRegistration("/")
    const sub = await reg?.pushManager.getSubscription()
    setPushState(sub && Notification.permission === "granted" ? "on" : "off")
  }, [])

  useEffect(() => {
    refreshPushState().catch(() => setPushState("unsupported"))
  }, [refreshPushState])

  const enablePush = async () => {
    setPushMessage(null)
    setPushState("working")
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "blocked" : "off")
        return
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      await navigator.serviceWorker.ready
      const keyRes = await fetch("/api/push/key")
      if (!keyRes.ok) throw new Error("no key")
      const { publicKey } = await keyRes.json()
      const sub = (await reg.pushManager.getSubscription()) ??
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      const res = await authFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) })
      if (!res.ok) throw new Error("subscribe failed")
      setPushState("on")
      await authFetch("/api/push/test", { method: "POST" })
      setPushMessage("Notifications are on. A test notification is on its way.")
    } catch (err) {
      console.error("Turning on notifications failed:", err)
      setPushMessage("Couldn't turn on notifications. Please try again.")
      await refreshPushState().catch(() => setPushState("off"))
    }
  }

  const disablePush = async () => {
    setPushMessage(null)
    setPushState("working")
    try {
      const reg = await navigator.serviceWorker.getRegistration("/")
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await authFetch("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) })
        await sub.unsubscribe()
      }
    } finally {
      await refreshPushState().catch(() => setPushState("off"))
    }
  }

  const unread = items.filter((n) => !lastSeen || n.createdAt > lastSeen).length

  const markAllRead = () => {
    const now = new Date().toISOString()
    setLastSeen(now)
    writeStore(seenKey, now)
  }

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    writeStore(soundKey, next ? "on" : "off")
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open && unread) markAllRead() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground" aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
          <span>Notifications</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleSound} aria-label={sound ? "Mute sound" : "Turn sound on"}>
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllRead}>Mark all read</Button>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />

        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No activity yet. New bookings, payments and collector reports will appear here.</p>
          )}
          {items.map((n) => {
            const Icon = TYPE_ICONS[n.type] ?? Bell
            const isNew = !lastSeen || n.createdAt > lastSeen
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onNavigate(n.section)}
                className={`flex w-full gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted ${isNew ? "bg-primary/5" : ""}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={`text-sm ${isNew ? "font-semibold" : "font-medium"}`}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                </span>
              </button>
            )
          })}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <div className="space-y-2 px-3 py-3 text-xs">
          {pushState === "on" && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-green-700"><BellRing className="h-3.5 w-3.5" /> Notifications on for this device</span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={disablePush}>Turn off</Button>
            </div>
          )}
          {(pushState === "off" || pushState === "working") && (
            <Button size="sm" className="w-full" disabled={pushState === "working"} onClick={enablePush}>
              <BellRing className="mr-2 h-4 w-4" />
              {pushState === "working" ? "Turning on…" : "Turn on notifications on this device"}
            </Button>
          )}
          {pushState === "blocked" && (
            <p className="flex gap-1.5 text-muted-foreground">
              <BellOff className="h-3.5 w-3.5 shrink-0" />
              Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reopen this menu.
            </p>
          )}
          {pushState === "ios-install" && (
            <p className="text-muted-foreground">
              On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>, open WasteCore from your Home Screen, then turn on notifications here.
            </p>
          )}
          {pushState === "unsupported" && (
            <p className="text-muted-foreground">This browser can&apos;t show notifications. Try Chrome, Edge or Firefox.</p>
          )}
          {pushMessage && <p className="text-muted-foreground">{pushMessage}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
