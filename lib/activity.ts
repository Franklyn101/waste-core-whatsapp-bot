import { addDoc, collection } from "firebase/firestore"
import { auth, db } from "./firebase"

// Records an admin action in activityLog (who, what, when). Never blocks or
// fails the action itself.
export function logActivity(action: string, details: Record<string, unknown> = {}): void {
  const user = auth.currentUser
  if (!user) return
  const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined))
  addDoc(collection(db, "activityLog"), {
    uid: user.uid,
    username: user.displayName || user.email?.split("@")[0] || "",
    action,
    ...clean,
    at: new Date().toISOString(),
  }).catch((err) => console.error("activity log failed", err))
}
