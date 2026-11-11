"use client"

import { useEffect, useState } from "react"
import { DatabaseBackup, Download, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAdminAuth } from "@/lib/admin-auth"

interface Backup {
  date: string
  status: "ok" | "failed"
  docs?: number
  bytes?: number
  trigger?: string
  error?: string
  createdAt?: string
  counts?: Record<string, number>
}

function size(bytes = 0): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function BackupsManager() {
  const { authFetch } = useAdminAuth()
  const [backups, setBackups] = useState<Backup[]>([])
  const [info, setInfo] = useState<{ keepDays: number; hour: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await authFetch("/api/backups")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBackups(data.backups)
      setInfo({ keepDays: data.keepDays, hour: data.hour })
    } catch {
      setMessage({ ok: false, text: "Could not load backups. Please refresh." })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const backUpNow = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const res = await authFetch("/api/backups", { method: "POST" })
      const data = await res.json()
      setMessage(res.ok
        ? { ok: true, text: `Backup saved: ${data.docs} records, ${size(data.bytes)}.` }
        : { ok: false, text: `Backup failed: ${data.error ?? "unknown error"}` })
      await load()
    } catch {
      setMessage({ ok: false, text: "Backup failed. Please try again." })
    } finally {
      setRunning(false)
    }
  }

  const download = async (date: string) => {
    try {
      const res = await authFetch(`/api/backups/${date}/link`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch {
      setMessage({ ok: false, text: "Could not download that backup. Please try again." })
    }
  }

  const latest = backups.find((b) => b.status === "ok")

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {latest ? `Last backup: ${new Date(latest.createdAt ?? latest.date).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "No backups yet"}
            </p>
            <p className="text-muted-foreground">
              The whole database is backed up automatically every night{info ? ` around ${info.hour}am` : ""} and
              kept for {info?.keepDays ?? 30} days, as private files in your Cloudinary account.
            </p>
          </div>
          <Button onClick={backUpNow} disabled={running}>
            <DatabaseBackup className={`mr-2 h-4 w-4 ${running ? "animate-pulse" : ""}`} />
            {running ? "Backing up…" : "Back up now"}
          </Button>
        </CardContent>
      </Card>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${message.ok ? "border-green-200 bg-green-50 text-green-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Backups ({backups.length})</span>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.date}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(`${b.date}T00:00:00`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                    {b.trigger === "manual" && <span className="ml-2 text-xs text-muted-foreground">(manual)</span>}
                  </TableCell>
                  <TableCell>
                    {b.status === "ok"
                      ? <Badge className="bg-green-100 text-green-800">Saved</Badge>
                      : <Badge className="bg-red-100 text-red-800" title={b.error}>Failed</Badge>}
                  </TableCell>
                  <TableCell className="text-right" title={b.counts ? Object.entries(b.counts).map(([k, v]) => `${k}: ${v}`).join("\n") : undefined}>
                    {b.docs?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{b.bytes ? size(b.bytes) : "—"}</TableCell>
                  <TableCell className="text-right">
                    {b.status === "ok" && (
                      <Button size="sm" variant="outline" onClick={() => download(b.date)}>
                        <Download className="mr-1 h-4 w-4" /> Download
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && backups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No backups yet. Press “Back up now” to make the first one.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Restoring a backup</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Restoring writes the backup&apos;s records back into the database. It&apos;s only needed if data is lost or damaged.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Download the backup you want (a <code>.json.gz</code> file).</li>
            <li>On a computer with the project, run <code>node scripts/restore-backup.js backup-YYYY-MM-DD.json.gz</code> to check what&apos;s in it.</li>
            <li>Add <code>--yes</code> to restore it (or <code>--only customers,subscribers</code> for some collections).</li>
          </ol>
          <p>If you&apos;re not sure, ask for help before restoring.</p>
        </CardContent>
      </Card>
    </div>
  )
}
