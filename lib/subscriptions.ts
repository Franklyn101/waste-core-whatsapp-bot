// Subscription plans, matching the prices the WhatsApp bot quotes.
// Monthly plans come in two categories, Business and Household; the old
// weekly plans are retired but kept so existing records still display.

export type SubscriptionKind = "business" | "household" | "weekly"

export const SUBSCRIPTION_KINDS: { id: SubscriptionKind; label: string }[] = [
  { id: "business", label: "Business" },
  { id: "household", label: "Household" },
  { id: "weekly", label: "Weekly (old)" },
]

export interface SubscriptionPlan {
  id: string
  kind: SubscriptionKind
  label: string
  price: number
  priceUnit: "week" | "month"
  // Pickups per week; the schedule must pick exactly this many days.
  pickupsPerWeek: number
  // Retired plan: still shown on old records, not offered for new ones.
  legacy?: boolean
}

const monthly = (kind: "business" | "household", n: number, price: number): SubscriptionPlan => ({
  id: `${kind}_${n}`,
  kind,
  label: `${n} pickup${n > 1 ? "s" : ""}/week`,
  price,
  priceUnit: "month",
  pickupsPerWeek: n,
})

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  monthly("business", 1, 5000),
  monthly("business", 2, 10000),
  monthly("business", 3, 15000),
  monthly("household", 1, 3000),
  monthly("household", 2, 6000),
  monthly("household", 3, 9000),
  // Retired plans
  { id: "weekly_1", kind: "weekly", label: "1 pickup/week", price: 1250, priceUnit: "week", pickupsPerWeek: 1, legacy: true },
  { id: "weekly_2", kind: "weekly", label: "2 pickups/week", price: 2500, priceUnit: "week", pickupsPerWeek: 2, legacy: true },
  { id: "weekly_3", kind: "weekly", label: "3 pickups/week", price: 3750, priceUnit: "week", pickupsPerWeek: 3, legacy: true },
  { id: "basic", kind: "business", label: "Basic (old plan)", price: 12000, priceUnit: "month", pickupsPerWeek: 1, legacy: true },
  { id: "standard", kind: "business", label: "Standard (old plan)", price: 20000, priceUnit: "month", pickupsPerWeek: 3, legacy: true },
  { id: "premium", kind: "business", label: "Premium (old plan)", price: 35000, priceUnit: "month", pickupsPerWeek: 7, legacy: true },
]

// One-off pickups are charged per bag (matches the WhatsApp bot); each
// booking stores its own totalAmount.
export const PICKUP_PRICE_PER_BAG: Record<string, number> = {
  instant: 1000,
  scheduled: 650,
}

// Flat price for one-off pickups booked before per-bag pricing.
const LEGACY_PICKUP_PRICES: Record<string, number> = {
  instant: 3000,
  scheduled: 3000,
}

export function findPlan(id: string | undefined): SubscriptionPlan | undefined {
  if (!id) return undefined
  return SUBSCRIPTION_PLANS.find((p) => p.id === id || p.id === id.replace(/^upgrade_/, ""))
}

export function planPriceLabel(plan: SubscriptionPlan): string {
  return `NGN ${plan.price.toLocaleString()}/${plan.priceUnit}`
}

// "Business · 2 pickups/week"
export function planFullLabel(plan: SubscriptionPlan): string {
  const kind = SUBSCRIPTION_KINDS.find((k) => k.id === plan.kind)
  return plan.kind === "weekly" ? `Weekly · ${plan.label}` : `${kind?.label} · ${plan.label}`
}

// Price for any stored serviceType: one-off pickups, monthly plans
// ("upgrade_business_2") or retired weekly plans ("weekly_1").
export function servicePrice(serviceType: string | undefined): number | undefined {
  if (!serviceType) return undefined
  return LEGACY_PICKUP_PRICES[serviceType] ?? findPlan(serviceType)?.price
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
