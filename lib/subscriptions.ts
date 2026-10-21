// Subscription plans, matching the prices the WhatsApp bot quotes.

export type SubscriptionKind = "weekly" | "monthly"

export interface SubscriptionPlan {
  id: string
  kind: SubscriptionKind
  label: string
  price: number
  priceUnit: "week" | "month"
  // Pickups per week; the schedule must pick exactly this many days.
  pickupsPerWeek: number
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  { id: "weekly_1", kind: "weekly", label: "1 pickup/week", price: 1250, priceUnit: "week", pickupsPerWeek: 1 },
  { id: "weekly_2", kind: "weekly", label: "2 pickups/week", price: 2500, priceUnit: "week", pickupsPerWeek: 2 },
  { id: "weekly_3", kind: "weekly", label: "3 pickups/week", price: 3750, priceUnit: "week", pickupsPerWeek: 3 },
  { id: "basic", kind: "monthly", label: "Basic", price: 12000, priceUnit: "month", pickupsPerWeek: 1 },
  { id: "standard", kind: "monthly", label: "Standard", price: 20000, priceUnit: "month", pickupsPerWeek: 3 },
  { id: "premium", kind: "monthly", label: "Premium", price: 35000, priceUnit: "month", pickupsPerWeek: 7 },
]

export function findPlan(id: string | undefined): SubscriptionPlan | undefined {
  if (!id) return undefined
  return SUBSCRIPTION_PLANS.find((p) => p.id === id || p.id === id.replace(/^upgrade_/, ""))
}

export function planPriceLabel(plan: SubscriptionPlan): string {
  return `NGN ${plan.price.toLocaleString()}/${plan.priceUnit}`
}

// Monday-first, matching how pickups are usually planned.
export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export type WeekDay = (typeof WEEK_DAYS)[number]

export const TIME_WINDOWS = [
  { id: "morning", label: "Morning (8am–12pm)" },
  { id: "afternoon", label: "Afternoon (12pm–4pm)" },
  { id: "evening", label: "Evening (4pm–7pm)" },
] as const

export const WASTE_TYPES = ["General", "Recyclables", "Organic / food", "Mixed", "Bulky items", "Other"]

const JS_DAY_TO_WEEKDAY: WeekDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Next date (today included) that falls on one of the pickup days, not
// before the start date. Returns null when no days are set.
export function nextPickupDate(days: string[], startDate?: string, from: Date = new Date()): Date | null {
  if (!days.length) return null
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  if (start && !isNaN(start.getTime()) && start > cursor) cursor.setTime(start.getTime())
  for (let i = 0; i < 7; i++) {
    if (days.includes(JS_DAY_TO_WEEKDAY[cursor.getDay()])) return cursor
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

export function sortDays(days: string[]): string[] {
  return [...days].sort((a, b) => WEEK_DAYS.indexOf(a as WeekDay) - WEEK_DAYS.indexOf(b as WeekDay))
}
