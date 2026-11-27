"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  cleanNearOrExpiredLocalNotifications,
  requestLocalNotificationPermission,
  synchronizeLocalNotifications,
  type NativeReminder,
} from "../lib/notifications";
import AuthScreen from "./AuthScreen";

import type {
  AccountKey,
  AnalysisMode,
  BaseBalances,
  Debt,
  FixedIncome,
  PersistedState,
  TabKey,
  Transaction,
  TransactionType,
  UserProfile,
} from "../lib/types";

const STORAGE_KEY = "fiyortx-app-v4";
const PRIVACY_STORAGE_KEY = "fiyortx-privacy-mode";
const MONTHLY_LIMIT_STORAGE_PREFIX = "fiyortx-monthly-limit:";
const REMINDER_SETTINGS_STORAGE_PREFIX = "fiyortx-reminder-settings:";
const DISMISSED_REMINDERS_STORAGE_PREFIX = "fiyortx-dismissed-reminders:";
const PRIVACY_EVENT = "fiyor-privacy-mode-change";
const MASKED_MONEY = "₺••••";

type IconName =
  | "home"
  | "transfer"
  | "history"
  | "analysis"
  | "logout"
  | "cash"
  | "bank"
  | "creditCard"
  | "benefit"
  | "savings"
  | "income"
  | "expense"
  | "net"
  | "count"
  | "trendUp"
  | "trendDown"
  | "trendFlat"
  | "eye"
  | "eyeOff"
  | "snowflake"
  | "settings"
  | "bell";

type MetricTrend = {
  direction: "up" | "down" | "flat";
  tone: "positive" | "negative" | "neutral";
  label: string;
};

type ReminderSettings = {
  statementDay: number | null;
  dueDay: number | null;
  enabled: boolean;
};

type ReminderSettingsDraft = {
  statementDay: string;
  dueDay: string;
  enabled: boolean;
};

type DashboardReminder = NativeReminder & {
  id: string;
  dateKey: string;
  dateLabel: string;
  kind: "fixed" | "card" | "limit" | "balance";
  amount?: number;
};

const defaultReminderSettings: ReminderSettings = {
  statementDay: null,
  dueDay: null,
  enabled: true,
};

const tabs: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Genel" },
  { id: "transaction", label: "İşlem" },
  { id: "history", label: "Geçmiş" },
  { id: "analysis", label: "Analiz" },
];

const tabIcons: Record<TabKey, IconName> = {
  overview: "home",
  transaction: "transfer",
  history: "history",
  analysis: "analysis",
};

const accountLabels: Record<AccountKey, string> = {
  cash: "Nakit",
  bank: "Banka",
  creditCard: "Kredi Kartı",
  benefit: "Yan Hak",
  savings: "Birikim",
};

function parseReminderDay(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
}

function parseLocalDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function isUserXL(profile: UserProfile | null, now = new Date()) {
  if (!profile || profile.plan !== "XL") return false;
  if (profile.planSource === "manual" || profile.planSource === "google_play") return true;
  return profile.planSource === "trial" && Boolean(
    profile.planExpiresAt && new Date(profile.planExpiresAt).getTime() > now.getTime(),
  );
}

function getXLMonthlyPrice(date = new Date()) {
  return localDateKey(date) <= "2026-12-30" ? 44 : 66;
}

function getTrialExpiresAt(createdAt: string) {
  const registeredAt = new Date(createdAt);
  if (!Number.isFinite(registeredAt.getTime())) return null;
  return new Date(registeredAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function mapUserProfile(
  row: {
    avatar_url?: string | null;
    plan?: unknown;
    plan_source?: unknown;
    plan_expires_at?: string | null;
  },
): UserProfile {
  const legacyPro = String(row.plan ?? "").toLowerCase() === "pro";
  const plan = String(row.plan ?? "").toUpperCase() === "XL" || legacyPro ? "XL" : "L";
  const source = row.plan_source;
  const planSource: PlanSource =
    source === "google_play" || source === "manual" || source === "trial"
      ? source
      : legacyPro
        ? "manual"
        : "trial";

  return {
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    plan,
    planSource,
    planExpiresAt: row.plan_expires_at ? String(row.plan_expires_at) : null,
  };
}

type DatabaseTransactionRow = {
  id: string | number;
  date: string;
  type: string;
  account: string;
  to_account?: string | null;
  fixed_income_id?: string | null;
  generated_month?: string | null;
  category: string;
  amount: string | number;
  note?: string | null;
  created_at: string;
  is_confirmed?: boolean | null;
  is_system_xl?: boolean | null;
  source?: string | null;
  debt_id?: string | null;
};

function mapDatabaseTransaction(row: DatabaseTransactionRow): Transaction {
  return {
    id: String(row.id),
    date: String(row.date),
    type: row.type as TransactionType,
    account: row.account as AccountKey,
    toAccount: row.to_account ? (row.to_account as AccountKey) : undefined,
    fixedIncomeId: row.fixed_income_id ? String(row.fixed_income_id) : undefined,
    generatedMonth: row.generated_month ? String(row.generated_month) : undefined,
    category: String(row.category),
    amount: Number(row.amount),
    note: String(row.note ?? ""),
    createdAt: String(row.created_at),
    isConfirmed: row.is_confirmed == null ? true : Boolean(row.is_confirmed),
    isSystemXL: Boolean(row.is_system_xl),
    source: (row.source as "manual" | "debtPayment") ?? "manual",
    debtId: row.debt_id ? String(row.debt_id) : undefined,
  };
}

function monthlyOccurrences(day: number, startDate: Date, daysAhead: number) {
  const occurrences: Date[] = [];
  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const date = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + offset,
    );
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    if (date.getDate() === Math.min(day, lastDay)) occurrences.push(date);
  }
  return occurrences;
}

function daysBetweenLocalDates(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function reminderDateLabel(date: Date, today: Date) {
  const daysUntil = daysBetweenLocalDates(today, date);
  if (daysUntil === 0) return "Bugün";
  return `${daysUntil} gün sonra`;
}

const accountOptions: AccountKey[] = ["cash", "bank", "creditCard", "benefit"];
const transferSourceOptions: AccountKey[] = ["cash", "bank", "benefit", "savings"];
const transferTargetOptions: AccountKey[] = ["cash", "bank", "savings", "creditCard"];
const quickExpenseCategories = [
  "Market",
  "Yakıt",
  "Yemek",
  "Fatura",
  "Ulaşım",
  "Kira",
  "Kişisel",
  "Eğlence",
];
const quickIncomeCategories = ["Maaş", "Prim", "Ek Gelir", "İade", "Satış"];

type HistoryFilter = "all" | "pending" | "income" | "expense" | "transfer";
type AnalysisDateFilter =
  | "month"
  | "all"
  | "past-2"
  | "past-3"
  | "past-6"
  | "future-2"
  | "future-3"
  | "future-6"
  | "custom";

type PlanSource = "trial" | "google_play" | "manual";

const planComparisonRows: {
  feature: string;
  free: string;
  xl: string;
  comingSoon?: boolean;
}[] = [
  { feature: "Temel Hesaplar & Bakiye", free: "Açık", xl: "Açık" },
  { feature: "Aylık İşlem Hakkı", free: "Ayda 3 işlem", xl: "Sınırsız" },
  { feature: "Kredi Kartı Taksit Takibi", free: "Sadece Peşin", xl: "2–12 Taksit" },
  { feature: "Analiz Tarih Aralığı", free: "Sadece Bu Ay", xl: "Geçmiş, Gelecek & Özel Aralık" },
  { feature: "AI Finans Analizi", free: "—", xl: "Yakında", comingSoon: true },
  { feature: "Birikim Hedefleri (Kumbara)", free: "—", xl: "Yakında", comingSoon: true },
  { feature: "CSV Dışa Aktarma & Hesap Silme", free: "Açık", xl: "Açık" },
];

type SavingsGoal = {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  createdAt: string;
};

const incomeCategories = [
  "Maaş",
  "Ek Gelir",
  "Prim",
  "Satış",
  "İade",
  "Kredi Kartı Ödemesi",
  "Diğer Gelir",
];

const expenseCategories = [
  "Market",
  "Dışarıda Yeme İçme",
  "Ulaşım",
  "Yakıt",
  "Fatura",
  "İnternet / Telefon",
  "Kira",
  "Abonelik",
  "Giyim",
  "Sağlık",
  "Eğitim",
  "Eğlence",
  "Ev / Temizlik",
  "Araç",
  "Alışveriş",
  "Kredi Kartı",
  "Borç / Taksit Ödemesi",
  "Diğer Gider",
];

const chartColors = [
  "#0284C7",
  "#0EA5E9",
  "#38BDF8",
  "#0369A1",
  "#06B6D4",
  "#059669",
  "#DC2626",
  "#2563EB",
  "#0D9488",
  "#1D4ED8",
  "#F97316",
  "#475569",
];

const incomeCategoryColors: Record<string, string> = {
  "Maaş": "#e2d51ecc",
  "Ek Gelir": "#14b8a6",
  "Prim": "#facc15",
  "Satış": "#38bdf8",
  "İade": "#86efac",
  "Kredi Kartı Ödemesi": "#818cf8",
  "Diğer Gelir": "#94a3b8",
};

const expenseCategoryColors: Record<string, string> = {
  "Market": "#fb923c",
  "Dışarıda Yeme İçme": "#f43f5e",
  "Ulaşım": "#60a5fa",
  "Yakıt": "#f59e0b",
  "Fatura": "#a78bfa",
  "İnternet/Telefon": "#2563eb",
  "Kira": "#ef4444",
  "Abonelik": "#d946ef",
  "Giyim": "#c084fc",
  "Sağlık": "#10b981",
  "Eğitim": "#6366f1",
  "Eğlence": "#ec4899",
  "Ev/Temizlik": "#d6a86c",
  "Araç": "#64748b",
  "Alışveriş": "#fb7185",
  "Kredi Kartı": "#dc2626",
  "Borç/Taksit Ödemesi": "#991b1b",
  "Diğer Gider": "#94a3b8",
};

const pieIncomeCategoryColors: Record<string, string> = {
  ...incomeCategoryColors,
  "Maaş": "#22c55e",
  "Prim": "#eab308",
  "Bonus": "#eab308",
  "Ek Gelir": "#eab308",
  "Satış": "#22c55e",
  "İade": "#22c55e",
  "Kredi Kartı Ödemesi": "#22c55e",
  "Diğer Gelir": "#22c55e",
};

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function dateInputFromDate(value: Date) {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `%${new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 1,
  }).format(safeValue)}`;
}

function formatMoney(value: number, hidden = false) {
  if (hidden) return MASKED_MONEY;
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatSignedMoney(value: number, hidden = false) {
  if (value > 0) return `+${formatMoney(value, hidden)}`;
  if (value < 0) return `-${formatMoney(Math.abs(value), hidden)}`;
  return formatMoney(0, hidden);
}

function subscribeToPrivacyMode(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PRIVACY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PRIVACY_EVENT, onChange);
  };
}

function getPrivacyModeSnapshot() {
  return localStorage.getItem(PRIVACY_STORAGE_KEY) === "true";
}

function getServerPrivacyModeSnapshot() {
  return true;
}

function formatDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  return `${month}.${year}`;
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + offset;
  const shiftedYear = Math.floor(monthIndex / 12);
  const shiftedMonth = monthIndex - shiftedYear * 12 + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

function endOfMonth(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  return dateInputFromDate(new Date(year, month, 0));
}

function addMonthsToDate(value: string, offset: number) {
  const [year, month, day] = value.split("-").map(Number);
  const targetMonth = new Date(year, month - 1 + offset, 1);
  const lastDay = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
  ).getDate();
  return dateInputFromDate(
    new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(day, lastDay)),
  );
}

function isMissingSavingsGoalsTable(error: { code: string }) {
  return error.code === "42P01" || error.code === "PGRST205";
}

function sortByCreatedAscending(a: Transaction, b: Transaction) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function sortByDateNewest(a: Transaction, b: Transaction) {
  const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function transactionDisplayCategory(transaction: Transaction) {
  const installment = transaction.note.match(/(?:^| · )Taksit (\d+\/\d+)/)?.[1];
  return installment
    ? `${transaction.category} (${installment})`
    : transaction.category;
}

function summarizeTransactions(items: Transaction[]) {
  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory: Record<string, number> = {};
  let transactionCount = 0;

  for (const item of items) {
    if (item.type === "income" && item.isConfirmed) totalIncome += item.amount;
    if (item.type === "expense" && item.isConfirmed) {
      totalExpense += item.amount;
      expenseByCategory[item.category] = (expenseByCategory[item.category] ?? 0) + item.amount;
    }
    if (item.type === "transfer" || item.isConfirmed) transactionCount += 1;
  }

  return {
    totalIncome,
    totalExpense,
    netFlow: totalIncome - totalExpense,
    transactionCount,
    expenseByCategory,
  };
}

function calculateBalances(baseBalances: BaseBalances, items: Transaction[]) {
  let cash = baseBalances.cash;
  let bank = baseBalances.bank;
  let benefit = baseBalances.benefit;
  let savings = baseBalances.savings;
  let creditDebt = baseBalances.creditDebt;

  for (const item of [...items].sort(sortByCreatedAscending)) {
    if (item.type === "expense" && item.isConfirmed) {
      if (item.account === "cash") cash -= item.amount;
      if (item.account === "bank") bank -= item.amount;
      if (item.account === "benefit") benefit -= item.amount;
      if (item.account === "creditCard") creditDebt += item.amount;
    }

    if (item.type === "income" && item.isConfirmed) {
      if (item.account === "cash") cash += item.amount;
      if (item.account === "bank") bank += item.amount;
      if (item.account === "benefit") benefit += item.amount;
      if (item.account === "creditCard") creditDebt = Math.max(0, creditDebt - item.amount);
    }

    if (item.type === "transfer" && item.toAccount) {
      if (item.account === "cash") cash -= item.amount;
      if (item.account === "bank") bank -= item.amount;
      if (item.account === "benefit") benefit -= item.amount;
      if (item.account === "savings") savings -= item.amount;

      if (item.toAccount === "cash") cash += item.amount;
      if (item.toAccount === "bank") bank += item.amount;
      if (item.toAccount === "savings") savings += item.amount;
      if (item.toAccount === "creditCard") {
        creditDebt = Math.max(0, creditDebt - item.amount);
      }
    }
  }

  const mainMoney = cash + bank;
  const totalAssets = cash + bank + savings - creditDebt;
  const totalSpendable = totalAssets + benefit;

  return {
    cash,
    bank,
    benefit,
    savings,
    creditDebt,
    mainMoney,
    totalSpendable,
    totalAssets,
  };
}

function getMetricTrend(current: number, previous: number, inverse = false): MetricTrend {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return {
      direction: "flat",
      tone: "neutral",
      label: current !== 0 ? "Bu dönemde aktif" : "Önceki dönem verisi yok",
    };
  }

  const difference = current - previous;
  if (difference === 0) {
    return {
      direction: "flat",
      tone: "neutral",
      label: "Önceki dönemle aynı",
    };
  }

  const percentage = Math.abs((difference / Math.abs(previous)) * 100);
  if (!Number.isFinite(percentage)) {
    return {
      direction: "flat",
      tone: "neutral",
      label: "Değişim hesaplanamadı",
    };
  }

  const direction = difference > 0 ? "up" : "down";
  const tone = inverse
    ? difference < 0
      ? "positive"
      : "negative"
    : difference > 0
      ? "positive"
      : "negative";

  return {
    direction,
    tone,
    label: `${formatPercent(percentage)} önceki döneme göre`,
  };
}

function getFallbackTrend(label: string, tone: MetricTrend["tone"] = "neutral"): MetricTrend {
  return { direction: "flat", tone, label };
}

function formatTrendPercent(current: number, previous: number) {
  if (previous === 0 && current > 0) return "+∞%";
  if (previous === 0) return "%0";
  const change = ((current - previous) / previous) * 100;
  const formatted = formatPercent(Math.abs(change));
  if (change > 0) return `+${formatted}`;
  if (change < 0) return `-${formatted}`;
  return "%0";
}

function getTrendTone(current: number, previous: number) {
  if (current > previous) return "positive";
  if (current < previous) return "negative";
  return "neutral";
}

function buildTrendLabel(current: number, previous: number, risingLabel: string, fallingLabel: string) {
  if (current > previous) return risingLabel;
  if (current < previous) return fallingLabel;
  return "Değişim yok";
}

function getTrendComparisonRange(selectedMonth: string | null) {
  if (!selectedMonth) return null;
  const previousMonth = shiftMonth(selectedMonth, -1);
  return {
    currentStart: `${selectedMonth}-01`,
    currentEnd: endOfMonth(selectedMonth),
    previousStart: `${previousMonth}-01`,
    previousEnd: endOfMonth(previousMonth),
  };
}

function parseAmountInput(value: string) {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned) return 0;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return Number(cleaned.replace(",", "."));
}

function createId(prefix = "id") {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function monthlyLimitStorageKey(userId: string) {
  return `${MONTHLY_LIMIT_STORAGE_PREFIX}${userId}`;
}

function reminderSettingsStorageKey(userId: string) {
  return `${REMINDER_SETTINGS_STORAGE_PREFIX}${userId}`;
}

function dismissedRemindersStorageKey(userId: string) {
  return `${DISMISSED_REMINDERS_STORAGE_PREFIX}${userId}`;
}

function readLocalReminderSettings(userId: string): ReminderSettings {
  try {
    const raw = localStorage.getItem(reminderSettingsStorageKey(userId));
    if (!raw) return defaultReminderSettings;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultReminderSettings;
    const values = parsed as Record<string, unknown>;
    return {
      statementDay: parseReminderDay(values.statementDay),
      dueDay: parseReminderDay(values.dueDay),
      enabled:
        typeof values.enabled === "boolean"
          ? values.enabled
          : defaultReminderSettings.enabled,
    };
  } catch (error) {
    console.error("Hatırlatma tercihleri yerel depolamadan okunamadı:", error);
    return defaultReminderSettings;
  }
}

function readDismissedReminders(userId: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(dismissedRemindersStorageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([month, ids]) =>
          /^\d{4}-\d{2}$/.test(month) &&
          Array.isArray(ids) &&
          ids.every((id) => typeof id === "string"),
      ),
    ) as Record<string, string[]>;
  } catch (error) {
    console.error("Okunmuş hatırlatmalar yerel depolamadan okunamadı:", error);
    return {};
  }
}

function parseMonthlyLimit(value: string | null): number | null {
  if (value === null || value === "null") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const privacyMode = useSyncExternalStore(
    subscribeToPrivacyMode,
    getPrivacyModeSnapshot,
    getServerPrivacyModeSnapshot,
  );
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [planClock, setPlanClock] = useState(() => Date.now());
  const [xlUpgradeOpen, setXLUpgradeOpen] = useState(false);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState<number | null>(null);
  const [monthlyLimitModalOpen, setMonthlyLimitModalOpen] = useState(false);
  const [monthlyLimitDraft, setMonthlyLimitDraft] = useState("");
  const [monthlyLimitSaving, setMonthlyLimitSaving] = useState(false);
  const [monthlyLimitError, setMonthlyLimitError] = useState("");
  const [fixedIncomes, setFixedIncomes] = useState<FixedIncome[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [savingsGoalsOwnerId, setSavingsGoalsOwnerId] = useState<string | null>(null);
  const [savingsGoalsLocalFallbackUserId, setSavingsGoalsLocalFallbackUserId] =
    useState<string | null>(null);
  const [savingsGoalModalOpen, setSavingsGoalModalOpen] = useState(false);
  const [savingsGoalTitle, setSavingsGoalTitle] = useState("");
  const [savingsGoalTarget, setSavingsGoalTarget] = useState("");
  const [savingsGoalInitial, setSavingsGoalInitial] = useState("");
  const [goalContributionId, setGoalContributionId] = useState<string | null>(null);
  const [goalContributionDraft, setGoalContributionDraft] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notificationSection, setNotificationSection] = useState<"items" | "settings">("items");
  const [reminderSettings, setReminderSettings] =
    useState<ReminderSettings>(defaultReminderSettings);
  const [reminderSettingsDraft, setReminderSettingsDraft] = useState<ReminderSettingsDraft>({
    statementDay: "",
    dueDay: "",
    enabled: true,
  });
  const [reminderSettingsReadyUserId, setReminderSettingsReadyUserId] = useState<string | null>(
    null,
  );
  const [reminderSettingsSaving, setReminderSettingsSaving] = useState(false);
  const [reminderSettingsError, setReminderSettingsError] = useState("");
  const [dismissedRemindersByMonth, setDismissedRemindersByMonth] = useState<
    Record<string, string[]>
  >({});
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState("");
  const [deleteAccountError, setDeleteAccountError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [fixedIncomeError, setFixedIncomeError] = useState("");
  const [fixedIncomeType, setFixedIncomeType] = useState<"income" | "expense">("income");
  const [fixedIncomeTitle, setFixedIncomeTitle] = useState("");
  const [fixedIncomeAmount, setFixedIncomeAmount] = useState("");
  const [fixedIncomeAccount, setFixedIncomeAccount] = useState<AccountKey>("bank");
  const [fixedIncomeDay, setFixedIncomeDay] = useState("1");
  const avatarFileInput = useRef<HTMLInputElement | null>(null);
  const generatedIncomeKeys = useRef(new Set<string>());
  const generatedIncomeMonth = useRef("");
  const notificationUserIdRef = useRef<string | null>(null);
  const permissionRequestedUserIdRef = useRef<string | null>(null);
  const userRef = useRef(user);
  const reminderSettingsRef = useRef(reminderSettings);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isScrolled, setIsScrolled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);

  const [baseBalances, setBaseBalances] = useState<BaseBalances>({
    cash: 0,
    bank: 0,
    benefit: 0,
    savings: 0,
    creditDebt: 0,
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [txType, setTxType] = useState<TransactionType>("expense");
  const [txAccount, setTxAccount] = useState<AccountKey>("bank");
  const [txTransferTarget, setTxTransferTarget] = useState<AccountKey>("cash");
  const [txCategory, setTxCategory] = useState(expenseCategories[0]);
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txDate, setTxDate] = useState(todayInputValue());
  const [txIsConfirmed, setTxIsConfirmed] = useState(true);
  const [installmentCount, setInstallmentCount] = useState("1");
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [editType, setEditType] = useState<TransactionType>("expense");
  const [editTransferSource, setEditTransferSource] = useState<AccountKey>("bank");
  const [editTransferTarget, setEditTransferTarget] = useState<AccountKey>("cash");
  const [editCategory, setEditCategory] = useState(expenseCategories[0]);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDate, setEditDate] = useState(todayInputValue());

  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("category");
  const [analysisReferenceDate] = useState(() => todayInputValue());
  const [selectedMonth, setSelectedMonth] = useState<string | null>(() =>
    todayInputValue().slice(0, 7),
  );
  const [analysisDateFilter, setAnalysisDateFilter] =
    useState<AnalysisDateFilter>("month");
  const [customRangeStart, setCustomRangeStart] = useState(todayInputValue());
  const [customRangeEnd, setCustomRangeEnd] = useState(todayInputValue());
  const isXL = isUserXL(profile, new Date(planClock));
  const isPlanRestricted = profile !== null && !isXL;
  const currentXLPrice = getXLMonthlyPrice(new Date(planClock));
  const trialExpiryTimestamp = profile?.planExpiresAt
    ? new Date(profile.planExpiresAt).getTime()
    : Number.NaN;
  const trialDaysRemaining =
    profile?.planSource === "trial" && Number.isFinite(trialExpiryTimestamp)
      ? Math.max(
          0,
          Math.ceil((trialExpiryTimestamp - planClock) / (24 * 60 * 60 * 1000)),
        )
      : null;

  useEffect(() => {
    const timer = window.setInterval(() => setPlanClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 12);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  const showToast = useCallback((message: string, duration = 2500) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => {
      setToastMessage("");
      toastTimer.current = null;
    }, duration);
  }, []);

  function togglePrivacyMode() {
    localStorage.setItem(PRIVACY_STORAGE_KEY, String(!privacyMode));
    window.dispatchEvent(new Event(PRIVACY_EVENT));
  }

  function openMonthlyLimitModal() {
    setMonthlyLimitDraft(monthlyLimit === null ? "" : String(monthlyLimit));
    setMonthlyLimitError("");
    setMonthlyLimitModalOpen(true);
  }

  function openXLUpgrade() {
    setXLUpgradeOpen(true);
  }

  async function persistMonthlyLimit(value: number | null) {
    if (!user) return false;

    setMonthlyLimitError("");
    setMonthlyLimitSaving(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, monthly_limit: value }, { onConflict: "id" })
        .select("id")
        .single();

      if (error) {
        console.error("Aylık limit kaydetme hatası:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        const message = `Limit kaydedilemedi [${error.code}]: ${error.message}`;
        setMonthlyLimitError(message);
        showToast(message, 7000);
        return false;
      }

      if (!data) {
        const message = "Limit kaydedilemedi: Supabase profil yanıtı boş döndü.";
        setMonthlyLimitError(message);
        showToast(message, 7000);
        return false;
      }

      setMonthlyLimit(value);
      try {
        localStorage.setItem(
          monthlyLimitStorageKey(user.id),
          value === null ? "null" : String(value),
        );
      } catch (cacheError) {
        console.error("Aylık limit önbelleğe yazma hatası:", cacheError);
        setMonthlyLimitError("Limit Supabase'e kaydedildi ancak bu cihazda önbelleğe alınamadı.");
      }
      return true;
    } catch (error) {
      console.error("Aylık limit kaydetme hatası:", error);
      const message = `Limit eşitlenemedi: ${
        error instanceof Error ? error.message : String(error)
      }`;
      setMonthlyLimitError(message);
      showToast(message, 7000);
      return false;
    } finally {
      setMonthlyLimitSaving(false);
    }
  }

  async function saveMonthlyLimit(event: React.FormEvent) {
    event.preventDefault();
    const amount = parseAmountInput(monthlyLimitDraft);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMonthlyLimitError("Aylık limit 0'dan büyük bir tutar olmalı.");
      return;
    }

    if (await persistMonthlyLimit(amount)) {
      setMonthlyLimitModalOpen(false);
      showToast("Aylık harcama limiti kaydedildi.");
    }
  }

  async function disableMonthlyLimit() {
    if (await persistMonthlyLimit(null)) {
      setMonthlyLimitModalOpen(false);
      showToast("Aylık harcama limiti kapatıldı.");
    }
  }

  async function saveReminderSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;

    const statementDay = parseReminderDay(reminderSettingsDraft.statementDay);
    const dueDay = parseReminderDay(reminderSettingsDraft.dueDay);
    if (
      (reminderSettingsDraft.statementDay !== "" && statementDay === null) ||
      (reminderSettingsDraft.dueDay !== "" && dueDay === null)
    ) {
      setReminderSettingsError("Gün alanlarına 1 ile 31 arasında bir sayı gir.");
      return;
    }

    const nextSettings: ReminderSettings = {
      statementDay,
      dueDay,
      enabled: reminderSettingsDraft.enabled,
    };
    try {
      localStorage.setItem(reminderSettingsStorageKey(user.id), JSON.stringify(nextSettings));
    } catch (error) {
      console.error("Hatırlatma tercihleri cihazda kaydedilemedi:", error);
      setReminderSettingsError("Ayarlar bu cihazda kaydedilemedi. Depolama alanını kontrol et.");
      return;
    }

    setReminderSettingsSaving(true);
    setReminderSettingsError("");
    try {
      let permissionDenied = false;
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          cc_statement_day: nextSettings.statementDay,
          cc_due_day: nextSettings.dueDay,
          notifications_enabled: nextSettings.enabled,
        },
        { onConflict: "id" },
      );
      if (error) {
        console.warn(
          "Hatırlatma tercihleri Supabase'e eşitlenemedi; cihazdaki kayıt korunuyor:",
          error.message,
        );
      }

      if (nextSettings.enabled) {
        permissionRequestedUserIdRef.current = user.id;
        try {
          const permission = await requestLocalNotificationPermission();
          permissionDenied = permission === false;
        } catch (permissionError) {
          console.warn("Yerel bildirim izni alınamadı:", permissionError);
        }
      }

      setReminderSettings(nextSettings);
      setReminderSettingsReadyUserId(user.id);
      showToast(
        permissionDenied
          ? "Ayarlar kaydedildi. Bildirim izni kapalı; hatırlatmalar uygulama içinde görünür."
          : "Hatırlatma ayarları kaydedildi.",
      );
    } catch (error) {
      console.error("Hatırlatma ayarları kaydedilemedi:", error);
      setReminderSettingsError(
        error instanceof Error ? error.message : "Hatırlatma ayarları kaydedilemedi.",
      );
    } finally {
      setReminderSettingsSaving(false);
    }
  }

  function markReminderRead(reminder: DashboardReminder) {
    const month = reminder.dateKey.slice(0, 7);
    const currentIds = dismissedRemindersByMonth[month] ?? [];
    if (currentIds.includes(reminder.id)) return;
    const nextDismissed = {
      ...dismissedRemindersByMonth,
      [month]: [...currentIds, reminder.id],
    };
    if (user) {
      try {
        localStorage.setItem(
          dismissedRemindersStorageKey(user.id),
          JSON.stringify(nextDismissed),
        );
      } catch (error) {
        console.error("Hatırlatma okundu olarak kaydedilemedi:", error);
        showToast("Hatırlatma okundu olarak kaydedilemedi.");
        return;
      }
    }
    setDismissedRemindersByMonth(nextDismissed);
  }

  const generateDueFixedIncomes = useCallback(
    async (incomes: FixedIncome[], targetUser: User) => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthEndDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (generatedIncomeMonth.current !== month) {
        generatedIncomeKeys.current.clear();
        generatedIncomeMonth.current = month;
      }
      let generatedCount = 0;
      let generationError = false;

      for (const income of incomes) {
        if (income.lastGeneratedMonth === month) continue;

        const key = `${targetUser.id}:${income.id}:${month}`;
        if (generatedIncomeKeys.current.has(key)) continue;

        const day = Math.min(income.dayOfMonth, monthEndDay);
        const date = `${month}-${String(day).padStart(2, "0")}`;
        if (date > todayInputValue()) continue;

        generatedIncomeKeys.current.add(key);

        const transactionId = createId("fixed-income");
        const { data: inserted, error: insertError } = await supabase
          .from("transactions")
          .upsert(
            {
              id: transactionId,
              user_id: targetUser.id,
              date,
              type: income.type,
              account: income.account,
              category: income.title,
              amount: income.amount,
              note: income.type === "income" ? "Sabit gelir" : "Sabit gider",
              created_at: new Date().toISOString(),
              is_confirmed: false,
              source: "manual",
              fixed_income_id: income.id,
              generated_month: month,
            },
            {
              onConflict: "fixed_income_id,generated_month",
              ignoreDuplicates: true,
            },
          )
          .select("*")
          .maybeSingle();

        if (insertError) {
          console.error("Sabit gelir oluşturma hatası:", insertError);
          setFixedIncomeError("Sabit işlem otomatik eklenemedi. Supabase şemanızı kontrol edin.");
          generatedIncomeKeys.current.delete(key);
          generationError = true;
          continue;
        }

        let generatedRow = inserted;
        if (!generatedRow) {
          const { data: existing, error: lookupError } = await supabase
            .from("transactions")
            .select("*")
            .eq("user_id", targetUser.id)
            .eq("fixed_income_id", income.id)
            .eq("generated_month", month)
            .maybeSingle();

          if (lookupError || !existing) {
            console.error("Oluşturulan sabit gelir kaydı okunamadı:", lookupError);
            setFixedIncomeError("Sabit işlem kaydı doğrulanamadı. Lütfen tekrar deneyin.");
            generatedIncomeKeys.current.delete(key);
            generationError = true;
            continue;
          }
          generatedRow = existing;
        }

        const generatedTransaction: Transaction = {
          id: String(generatedRow.id),
          date: String(generatedRow.date),
          type: income.type,
          account: generatedRow.account as AccountKey,
          category: String(generatedRow.category),
          amount: Number(generatedRow.amount),
          note: String(generatedRow.note ?? ""),
          createdAt: String(generatedRow.created_at),
          isConfirmed: Boolean(generatedRow.is_confirmed),
          source: "manual",
          fixedIncomeId: income.id,
          generatedMonth: month,
        };

        setTransactions((current) =>
          current.some(
            (item) =>
              item.id === generatedTransaction.id ||
              (item.fixedIncomeId === income.id && item.generatedMonth === month),
          )
            ? current
            : [generatedTransaction, ...current],
        );

        const { error: markerError } = await supabase
          .from("fixed_incomes")
          .update({ last_generated_month: month })
          .eq("id", income.id)
          .eq("user_id", targetUser.id);

        if (markerError) {
          console.error("Sabit gelir dönemi güncelleme hatası:", markerError);
          setFixedIncomeError("Sabit işlem oluşturuldu ancak dönem bilgisi güncellenemedi.");
          generationError = true;
        } else {
          setFixedIncomes((current) =>
            current.map((item) =>
              item.id === income.id ? { ...item, lastGeneratedMonth: month } : item,
            ),
          );
        }

        generatedCount += 1;
      }

      if (!generationError) setFixedIncomeError("");
      if (generatedCount > 0) {
        showToast(`${generatedCount} sabit gelir/gider Geçmiş'e bekliyor olarak eklendi.`);
      }
    },
    [showToast],
  );

  async function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;

    if (file.type && !file.type.startsWith("image/")) {
      setAvatarError("Bir görsel dosyası seç.");
      return;
    }

    setAvatarUploading(true);
    setAvatarError("");
    try {
      const blob = await resizeAvatarImage(file);
      const filePath = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.error("Profil fotoğrafı yükleme hatası:", uploadError);
        setAvatarError(`Fotoğraf yüklenemedi: ${uploadError.message}`);
        return;
      }

      const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const avatarUrl = `${publicUrl.publicUrl}?v=${createId("avatar")}`;
      const { data: updatedProfile, error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("*")
        .single();

      if (profileUpdateError) {
        console.error("Profil fotoğrafı kaydetme hatası:", profileUpdateError);
        setAvatarError(`Fotoğraf yüklendi ancak profile kaydedilemedi: ${profileUpdateError.message}`);
        return;
      }

      setProfile(mapUserProfile(updatedProfile));
      setAvatarError("");
      showToast("Profil fotoğrafı güncellendi.");
    } catch (error) {
      console.error("Profil fotoğrafı işleme hatası:", error);
      const message = error instanceof Error ? error.message : String(error);
      setAvatarError(`Fotoğraf işlenemedi: ${message}`);
    } finally {
      setAvatarUploading(false);
    }
  }

  function handleFixedIncomeTypeChange(nextType: "income" | "expense") {
    setFixedIncomeType(nextType);
    if (
      (nextType === "expense" && fixedIncomeAccount === "savings") ||
      (nextType === "income" && fixedIncomeAccount === "creditCard")
    ) {
      setFixedIncomeAccount("bank");
    }
  }

  async function addFixedIncome(event: React.FormEvent) {
    event.preventDefault();
    if (!user || privacyMode) return;

    const amount = parseAmountInput(fixedIncomeAmount);
    const day = Number(fixedIncomeDay);
    const title = fixedIncomeTitle.trim();
    if (!title || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(day) || day < 1 || day > 31) {
      setFixedIncomeError("Başlık, pozitif tutar ve 1-31 arasında bir gün gir.");
      return;
    }

    const { data, error } = await supabase
      .from("fixed_incomes")
      .insert({
        user_id: user.id,
        type: fixedIncomeType,
        title,
        amount,
        account: fixedIncomeAccount,
        day_of_month: day,
      })
      .select("id,type,title,amount,account,day_of_month,last_generated_month,created_at")
      .single();

    if (error) {
      console.error("Sabit işlem ekleme hatası:", error);
      setFixedIncomeError("Sabit işlem eklenemedi. Supabase şemanızı ve izinleri kontrol edin.");
      return;
    }

    const addedIncome: FixedIncome = {
      id: String(data.id),
      type: data.type === "expense" ? "expense" : "income",
      title: String(data.title),
      amount: Number(data.amount),
      account: data.account as AccountKey,
      dayOfMonth: Number(data.day_of_month),
      lastGeneratedMonth: data.last_generated_month
        ? String(data.last_generated_month)
        : null,
      createdAt: String(data.created_at),
    };

    setFixedIncomes((current) => [addedIncome, ...current]);
    setFixedIncomeTitle("");
    setFixedIncomeAmount("");
    setFixedIncomeDay("1");
    setFixedIncomeError("");
    showToast(fixedIncomeType === "income" ? "Sabit gelir eklendi." : "Sabit gider eklendi.");
    await generateDueFixedIncomes([addedIncome], user);
  }

  async function deleteFixedIncome(incomeId: string) {
    if (!user) return;
    const { error } = await supabase
      .from("fixed_incomes")
      .delete()
      .eq("id", incomeId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Sabit gelir silme hatası:", error);
      setFixedIncomeError("Sabit gelir silinemedi. Lütfen tekrar dene.");
      return;
    }

    setFixedIncomes((current) => current.filter((item) => item.id !== incomeId));
    setFixedIncomeError("");
    showToast("Sabit gelir silindi.");
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Oturum kapatma hatası:", error);
    else setAccountMenuOpen(false);
  }

  async function exportUserData() {
    if (!user || !loaded || loadedUserId !== user.id) return;

    const escapeCsvCell = (value: string | number | null | undefined) => {
      let text = value == null ? "" : String(value);
      if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const headers = [
      "Kayıt Grubu",
      "Tarih",
      "Tür",
      "Başlık",
      "Kategori",
      "Hesap",
      "Tutar (₺)",
      "Durum",
      "Ayın Günü",
      "Son Oluşturulan Ay",
    ];
    const transactionRows = transactions.map((transaction) => [
      "İşlem",
      transaction.date,
      transaction.type === "income"
        ? "Gelir"
        : transaction.type === "expense"
          ? "Gider"
          : "Transfer",
      transaction.note,
      transaction.category,
      transaction.type === "transfer"
        ? `${accountLabels[transaction.account]} → ${accountLabels[transaction.toAccount ?? "cash"]}`
        : accountLabels[transaction.account],
      transaction.amount.toLocaleString("tr-TR", { useGrouping: false }),
      transaction.type === "transfer"
        ? "Tamamlandı"
        : transaction.isConfirmed
          ? transaction.type === "expense"
            ? "Ödendi"
            : "Alındı"
          : "Bekliyor",
      "",
      "",
    ]);
    const fixedIncomeRows = fixedIncomes.map((income) => [
      "Sabit kayıt",
      income.createdAt.slice(0, 10),
      income.type === "income" ? "Sabit gelir" : "Sabit gider",
      income.title,
      "",
      accountLabels[income.account],
      income.amount.toLocaleString("tr-TR", { useGrouping: false }),
      "Aktif",
      income.dayOfMonth,
      income.lastGeneratedMonth ?? "",
    ]);
    const csv = `\uFEFF${[headers, ...transactionRows, ...fixedIncomeRows]
      .map((row) => row.map(escapeCsvCell).join(";"))
      .join("\r\n")}`;
    const date = new Date();
    const fileName = `fiyortx-veriler-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.csv`;

    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      if (typeof File !== "undefined" && navigator.share) {
        const file = new File([blob], fileName, { type: "text/csv;charset=utf-8" });
        try {
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "Fiyor₺X verilerim" });
            showToast("CSV dosyan paylaşım için hazır.");
            return;
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          console.error("CSV paylaşımı başarısız, indirmeye geçiliyor:", error);
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      showToast("Verilerin CSV dosyası olarak indirildi.");
    } catch (error) {
      console.error("CSV dışa aktarma hatası:", error);
      showToast(
        `CSV dosyası oluşturulamadı: ${error instanceof Error ? error.message : String(error)}`,
        7000,
      );
    }
  }

  async function deleteOwnAccount() {
    if (!user || deleteAccountConfirmation !== "SİL" || deletingAccount) return;

    const userId = user.id;
    setDeletingAccount(true);
    setDeleteAccountError("");

    try {
      const { error } = await supabase.rpc("delete_own_account");
      if (error) throw error;

      let cleanupWarning = "";
      try {
        localStorage.removeItem(`${STORAGE_KEY}:${userId}`);
        localStorage.removeItem(monthlyLimitStorageKey(userId));
      } catch (error) {
        console.error("Hesap silindikten sonra yerel önbellek temizlenemedi:", error);
        cleanupWarning = " Bu cihazdaki yerel önbellek tamamen temizlenemedi.";
      }

      setLoaded(false);
      setLoadedUserId(null);
      setTransactions([]);
      setFixedIncomes([]);
      setDebts([]);
      setBaseBalances({
        cash: 0,
        bank: 0,
        benefit: 0,
        savings: 0,
        creditDebt: 0,
      });
      setProfile(null);
      setMonthlyLimit(null);
      setProfileError("");
      setAvatarError("");
      setPendingDeleteId(null);
      setActiveTab("overview");
      setAccountMenuOpen(false);
      setDeleteAccountModalOpen(false);
      setDeleteAccountConfirmation("");
      setUser(null);
      setAuthReady(true);
      generatedIncomeKeys.current.clear();
      generatedIncomeMonth.current = "";

      let signOutWarning = "";
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error("Hesap silindi ancak oturum kapatılamadı:", signOutError);
          signOutWarning = " Yerel oturum kapatılırken bir sorun oluştu.";
          const { error: localSignOutError } = await supabase.auth.signOut({ scope: "local" });
          if (localSignOutError) {
            console.error("Yerel oturum temizlenemedi:", localSignOutError);
          }
        }
      } catch (error) {
        console.error("Hesap silindi ancak oturum kapatma isteği başarısız:", error);
        signOutWarning = " Yerel oturum kapatılırken bir sorun oluştu.";
        try {
          const { error: localSignOutError } = await supabase.auth.signOut({ scope: "local" });
          if (localSignOutError) {
            console.error("Yerel oturum temizlenemedi:", localSignOutError);
          }
        } catch (localSignOutError) {
          console.error("Yerel oturum temizlenemedi:", localSignOutError);
        }
      }

      showToast(`Hesabın kalıcı olarak silindi.${cleanupWarning}${signOutWarning}`, 7000);
    } catch (error) {
      console.error("Hesap silme hatası:", error);
      setDeleteAccountError(
        `Hesap silinemedi: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setDeletingAccount(false);
    }
  }

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handleAccountMenuKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleteAccountModalOpen) setAccountMenuOpen(false);
    }

    window.addEventListener("keydown", handleAccountMenuKeyDown);
    return () => window.removeEventListener("keydown", handleAccountMenuKeyDown);
  }, [accountMenuOpen, deleteAccountModalOpen]);

  useEffect(() => {
    if (!deleteAccountModalOpen) return;

    function handleDeleteAccountKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deletingAccount) {
        setDeleteAccountModalOpen(false);
        setDeleteAccountConfirmation("");
        setDeleteAccountError("");
      }
    }

    window.addEventListener("keydown", handleDeleteAccountKeyDown);
    return () => window.removeEventListener("keydown", handleDeleteAccountKeyDown);
  }, [deleteAccountModalOpen, deletingAccount]);

  useEffect(() => {
    if (!pendingDeleteId && !pendingDeleteGoalId) return;

    deleteCancelButtonRef.current?.focus();
    function handleDeleteModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deletingTransactionId && !deletingGoal) {
        setPendingDeleteId(null);
        setPendingDeleteGoalId(null);
      }
    }

    window.addEventListener("keydown", handleDeleteModalKeyDown);
    return () => window.removeEventListener("keydown", handleDeleteModalKeyDown);
  }, [deletingGoal, deletingTransactionId, pendingDeleteGoalId, pendingDeleteId]);

  // 0. KULLANICI OTURUMUNU DİNLEME
  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    function applySession(sessionUser: User | null) {
      setUser(sessionUser);
      if (sessionUser) {
        try {
          setMonthlyLimit(
            parseMonthlyLimit(localStorage.getItem(monthlyLimitStorageKey(sessionUser.id))),
          );
        } catch (error) {
          console.error("Aylık limit önbelleği okunamadı:", error);
        }
      } else {
        setMonthlyLimit(null);
      }
      setAuthReady(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      applySession(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!active || authEventReceived) return;
      if (error) {
        console.error("Oturum yükleme hatası:", {
          code: error.code,
          message: error.message,
        });
        showToast(`Oturum yüklenemedi [${error.code}]: ${error.message}`, 7000);
      }
      applySession(session?.user ?? null);
    }).catch((error: unknown) => {
      if (!active || authEventReceived) return;
      console.error("Oturum yükleme hatası:", error);
      showToast(
        `Oturum yüklenemedi: ${error instanceof Error ? error.message : String(error)}`,
        7000,
      );
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [showToast]);

  useEffect(() => {
    if (!authReady || !user || !loaded || loadedUserId !== user.id) {
      return;
    }

    let cancelled = false;
    const localSettings = readLocalReminderSettings(user.id);
    queueMicrotask(() => {
      if (cancelled) return;
      setReminderSettings(localSettings);
      setReminderSettingsDraft({
        statementDay:
          localSettings.statementDay == null ? "" : String(localSettings.statementDay),
        dueDay: localSettings.dueDay == null ? "" : String(localSettings.dueDay),
        enabled: localSettings.enabled,
      });
      setDismissedRemindersByMonth(readDismissedReminders(user.id));
    });

    async function loadReminderSettings() {
      const { data, error } = await supabase
        .from("profiles")
        .select("cc_statement_day,cc_due_day,notifications_enabled")
        .eq("id", user!.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn(
          "Profil hatırlatma sütunları kullanılamıyor; yerel tercihler kullanılacak:",
          error.message,
        );
      } else if (data) {
        const cloudSettings: ReminderSettings = {
          statementDay: parseReminderDay(data.cc_statement_day) ?? localSettings.statementDay,
          dueDay: parseReminderDay(data.cc_due_day) ?? localSettings.dueDay,
          enabled:
            typeof data.notifications_enabled === "boolean"
              ? data.notifications_enabled
              : localSettings.enabled,
        };
        setReminderSettings(cloudSettings);
        setReminderSettingsDraft({
          statementDay:
            cloudSettings.statementDay == null ? "" : String(cloudSettings.statementDay),
          dueDay: cloudSettings.dueDay == null ? "" : String(cloudSettings.dueDay),
          enabled: cloudSettings.enabled,
        });
        try {
          localStorage.setItem(
            reminderSettingsStorageKey(user!.id),
            JSON.stringify(cloudSettings),
          );
        } catch (cacheError) {
          console.warn("Hatırlatma tercihleri cihazda önbelleğe alınamadı:", cacheError);
        }
      }

      setReminderSettingsReadyUserId(user!.id);
    }

    void loadReminderSettings().catch((error: unknown) => {
      if (cancelled) return;
      console.error("Hatırlatma tercihleri yüklenemedi:", error);
      setReminderSettingsReadyUserId(user!.id);
    });

    return () => {
      cancelled = true;
    };
  }, [authReady, loaded, loadedUserId, user]);

  // 1. GİRİŞ YAPAN KULLANICININ VERİLERİNİ SUPABASE'DEN ÇEKME
  useEffect(() => {
    if (!authReady) return;
    if (!user) return;

    let cancelled = false;

    async function loadFromSupabase() {
      try {
        const userStorageKey = `${STORAGE_KEY}:${user!.id}`;
        try {
          const cachedState = localStorage.getItem(userStorageKey);
          if (cachedState) {
            const parsedState = JSON.parse(cachedState) as Partial<PersistedState>;
            if (parsedState.baseBalances && typeof parsedState.baseBalances === "object") {
              setBaseBalances((current) => ({ ...current, ...parsedState.baseBalances }));
            }
            if (Array.isArray(parsedState.transactions)) {
              setTransactions(parsedState.transactions);
            }
            if (Array.isArray(parsedState.debts)) {
              setDebts(parsedState.debts);
            }
          }
        } catch (cacheError) {
          console.error("Yerel veri önbelleği okunamadı:", cacheError);
        }

        const [balanceRes, txRes, debtRes, initialProfileRes, fixedIncomeRes] = await Promise.all([
          supabase.from("base_balances").select("*").eq("user_id", user!.id).maybeSingle(),
          supabase.from("transactions").select("*").eq("user_id", user!.id),
          supabase.from("debts").select("*").eq("user_id", user!.id),
          supabase
            .from("profiles")
            .select("avatar_url,plan,plan_source,plan_expires_at,monthly_limit")
            .eq("id", user!.id)
            .maybeSingle(),
          supabase
            .from("fixed_incomes")
            .select("id,type,title,amount,account,day_of_month,last_generated_month,created_at")
            .eq("user_id", user!.id),
        ]);

        if (cancelled) return;

        let profileRes = initialProfileRes;
        let planColumnsAvailable = true;
        if (
          profileRes.error &&
          (profileRes.error.code === "42703" || profileRes.error.code === "PGRST204")
        ) {
          profileRes = await supabase
            .from("profiles")
            .select("avatar_url,plan,monthly_limit")
            .eq("id", user!.id)
            .maybeSingle();
          if (cancelled) return;
          planColumnsAvailable = false;
        }

        const loadErrors: string[] = [];
        function recordLoadError(label: string, error: {
          code: string;
          message: string;
          details: string;
          hint: string;
        }) {
          console.error(label, {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          loadErrors.push(`[${error.code}] ${error.message}`);
        }

        if (balanceRes.error) {
          recordLoadError("Bakiye yükleme hatası:", balanceRes.error);
        } else {
          setBaseBalances({
            cash: Number(balanceRes.data?.cash ?? 0),
            bank: Number(balanceRes.data?.bank ?? 0),
            benefit: Number(balanceRes.data?.benefit ?? 0),
            savings: Number(balanceRes.data?.savings ?? 0),
            creditDebt: Number(balanceRes.data?.credit_debt ?? 0),
          });
        }

        let dbTransactions: Transaction[] = (txRes.data ?? []).map(
          (row: DatabaseTransactionRow) => mapDatabaseTransaction(row),
        );
        if (txRes.error) {
          recordLoadError("İşlem yükleme hatası:", txRes.error);
        } else {
          setTransactions(dbTransactions);
        }

        const dbDebts: Debt[] = (debtRes.data ?? []).map((row: {
          id: string | number;
          title: string;
          amount: string | number;
          due_date: string;
          note: string | null;
          paid: boolean | null;
          paid_from: string | null;
          paid_at: string | null;
          paid_transaction_id: string | null;
          created_at: string;
        }) => ({
          id: String(row.id),
          title: String(row.title),
          amount: Number(row.amount),
          dueDate: String(row.due_date),
          note: String(row.note ?? ""),
          paid: Boolean(row.paid),
          paidFrom: row.paid_from as AccountKey | undefined,
          paidAt: row.paid_at ? String(row.paid_at) : undefined,
          paidTransactionId: row.paid_transaction_id ? String(row.paid_transaction_id) : undefined,
          createdAt: String(row.created_at),
        }));
        if (debtRes.error) {
          recordLoadError("Borç yükleme hatası:", debtRes.error);
        } else {
          setDebts(dbDebts);
        }

        const dbFixedIncomes: FixedIncome[] = (fixedIncomeRes.data ?? []).map((row: {
          id: string;
          type: string;
          title: string;
          amount: string | number;
          account: AccountKey;
          day_of_month: number;
          last_generated_month: string | null;
          created_at: string;
        }) => ({
          id: String(row.id),
          type: row.type === "expense" ? "expense" : "income",
          title: String(row.title),
          amount: Number(row.amount),
          account: row.account as AccountKey,
          dayOfMonth: Number(row.day_of_month),
          lastGeneratedMonth: row.last_generated_month
            ? String(row.last_generated_month)
            : null,
          createdAt: String(row.created_at),
        }));

        let resolvedProfile: UserProfile | null = null;
        if (profileRes.error) {
          recordLoadError("Profil yükleme hatası:", profileRes.error);
          setProfileError(
            `Profil bilgileri yüklenemedi [${profileRes.error.code}]: ${profileRes.error.message}`,
          );
        } else if (profileRes.data) {
          resolvedProfile = mapUserProfile(profileRes.data);
          setProfile(resolvedProfile);
          const loadedMonthlyLimit = parseMonthlyLimit(
            profileRes.data.monthly_limit == null
              ? null
              : String(profileRes.data.monthly_limit),
          );
          setMonthlyLimit(loadedMonthlyLimit);
          try {
            localStorage.setItem(
              monthlyLimitStorageKey(user!.id),
              loadedMonthlyLimit === null ? "null" : String(loadedMonthlyLimit),
            );
          } catch (cacheError) {
            console.error("Aylık limit önbelleğe yazma hatası:", cacheError);
          }
        } else {
          const cachedMonthlyLimit = parseMonthlyLimit(
            localStorage.getItem(monthlyLimitStorageKey(user!.id)),
          );
          const trialExpiresAt = getTrialExpiresAt(user!.created_at);
          if (planColumnsAvailable && !trialExpiresAt) {
            throw new Error("Hesap kayıt tarihi okunamadığı için XL deneme süresi oluşturulamadı.");
          }
          let createdProfile: {
            avatar_url: string | null;
            plan: string | null;
            plan_source?: string | null;
            plan_expires_at?: string | null;
            monthly_limit: string | number | null;
          } | null = null;
          let createProfileError: {
            code: string;
            message: string;
            details: string;
            hint: string;
          } | null = null;
          if (planColumnsAvailable) {
            const result = await supabase
              .from("profiles")
              .upsert(
                {
                  id: user!.id,
                  monthly_limit: cachedMonthlyLimit,
                  plan: "XL",
                  plan_source: "trial",
                  plan_expires_at: trialExpiresAt,
                },
                { onConflict: "id" },
              )
              .select("avatar_url,plan,plan_source,plan_expires_at,monthly_limit")
              .single();
            if (cancelled) return;
            createdProfile = result.data;
            createProfileError = result.error;
          } else {
            const result = await supabase
              .from("profiles")
              .upsert(
                { id: user!.id, monthly_limit: cachedMonthlyLimit },
                { onConflict: "id" },
              )
              .select("avatar_url,plan,monthly_limit")
              .single();
            if (cancelled) return;
            createdProfile = result.data;
            createProfileError = result.error;
          }

          if (createProfileError || !createdProfile) {
            if (createProfileError) {
              recordLoadError("Profil oluşturma hatası:", createProfileError);
            }
            setProfileError(
              createProfileError
                ? `Profil oluşturulamadı [${createProfileError.code}]: ${createProfileError.message}`
                : "Profil oluşturulamadı: Supabase profil yanıtı boş döndü.",
            );
          } else {
            resolvedProfile = mapUserProfile(createdProfile);
            setProfile(resolvedProfile);
            const createdMonthlyLimit = parseMonthlyLimit(
              createdProfile.monthly_limit == null
                ? null
                : String(createdProfile.monthly_limit),
            );
            setMonthlyLimit(createdMonthlyLimit);
            try {
              localStorage.setItem(
                monthlyLimitStorageKey(user!.id),
                createdMonthlyLimit === null ? "null" : String(createdMonthlyLimit),
              );
            } catch (cacheError) {
              console.error("Aylık limit önbelleğe yazma hatası:", cacheError);
            }
          }
        }

        let profileConfigurationError: string | null = null;
        if (
          resolvedProfile?.plan === "XL" &&
          resolvedProfile.planSource === "trial" &&
          !resolvedProfile.planExpiresAt &&
          planColumnsAvailable
        ) {
          const trialExpiresAt = getTrialExpiresAt(user!.created_at);
          if (trialExpiresAt) {
            const { error: expiryUpdateError } = await supabase
              .from("profiles")
              .update({ plan_expires_at: trialExpiresAt })
              .eq("id", user!.id);
            if (cancelled) return;
            if (expiryUpdateError) {
              console.error("XL deneme bitiş tarihi kaydedilemedi:", expiryUpdateError);
              profileConfigurationError =
                `XL deneme bitiş tarihi kaydedilemedi [${expiryUpdateError.code}]: ${expiryUpdateError.message}`;
            } else {
              resolvedProfile = { ...resolvedProfile, planExpiresAt: trialExpiresAt };
              setProfile(resolvedProfile);
            }
          }
        }

        if (resolvedProfile && planColumnsAvailable) {
          setProfileError(profileConfigurationError ?? "");
        } else if (resolvedProfile) {
          const migrationMessage =
            "Plan sistemi için Supabase SQL güncellemesini uygulaman gerekiyor.";
          setProfileError(migrationMessage);
          showToast(migrationMessage, 7000);
        }

        if (resolvedProfile && planColumnsAvailable && !txRes.error) {
          if (!dbTransactions.some((item) => item.isSystemXL)) {
            const subscriptionDate =
              resolvedProfile.planExpiresAt ?? getTrialExpiresAt(user!.created_at);
            if (!subscriptionDate) {
              throw new Error("XL abonelik işlemi için kayıt tarihi okunamadı.");
            }
            const systemTransaction = {
              id: user!.id,
              user_id: user!.id,
              date: localDateKey(new Date(subscriptionDate)),
              type: "expense",
              account: "bank",
              category: "Fiyor₺X XL Aboneliği",
              amount: getXLMonthlyPrice(),
              note: "1 kahve parasına koca ayın hesabı — yine de sen bilirsin.",
              created_at: new Date().toISOString(),
              is_confirmed: false,
              is_system_xl: true,
              source: "manual",
            };
            const { data: insertedSystemTransaction, error: systemTransactionError } =
              await supabase
                .from("transactions")
                .upsert(systemTransaction, { onConflict: "id", ignoreDuplicates: true })
                .select("*")
                .maybeSingle();
            if (cancelled) return;

            if (systemTransactionError) {
              console.error("XL abonelik sistem işlemi oluşturulamadı:", systemTransactionError);
              showToast(
                `XL abonelik işlemi oluşturulamadı [${systemTransactionError.code}]: ${systemTransactionError.message}`,
                8000,
              );
              setProfileError(
                `XL abonelik işlemi oluşturulamadı [${systemTransactionError.code}]: ${systemTransactionError.message}`,
              );
            } else {
              let savedSystemTransaction = insertedSystemTransaction;
              if (!savedSystemTransaction) {
                const { data: existingSystemTransaction, error: lookupError } = await supabase
                  .from("transactions")
                  .select("*")
                  .eq("user_id", user!.id)
                  .eq("is_system_xl", true)
                  .maybeSingle();
                if (cancelled) return;
                if (lookupError) {
                  console.error("XL abonelik sistem işlemi doğrulanamadı:", lookupError);
                  showToast(
                    `XL abonelik işlemi doğrulanamadı [${lookupError.code}]: ${lookupError.message}`,
                    8000,
                  );
                  setProfileError(
                    `XL abonelik işlemi doğrulanamadı [${lookupError.code}]: ${lookupError.message}`,
                  );
                } else {
                  savedSystemTransaction = existingSystemTransaction;
                }
              }
              if (savedSystemTransaction) {
                dbTransactions = [
                  ...dbTransactions,
                  mapDatabaseTransaction(savedSystemTransaction),
                ];
                setTransactions(dbTransactions);
              } else {
                setProfileError("XL abonelik sistem işlemi kaydedildi ancak okunamadı.");
                showToast("XL abonelik sistem işlemi kaydedildi ancak okunamadı.", 8000);
              }
            }
          }
        }

        if (fixedIncomeRes.error) {
          recordLoadError("Sabit gelirler yükleme hatası:", fixedIncomeRes.error);
          setFixedIncomeError(
            `Sabit gelir/gider kayıtları yüklenemedi [${fixedIncomeRes.error.code}]: ${fixedIncomeRes.error.message}`,
          );
        } else {
          setFixedIncomeError("");
          setFixedIncomes(dbFixedIncomes);
        }

        if (!fixedIncomeRes.error) {
          await generateDueFixedIncomes(dbFixedIncomes, user!);
        }

        if (cancelled) return;
        if (loadErrors.length > 0) {
          showToast(`Supabase yükleme hatası: ${loadErrors.join(" · ")}`, 9000);
        }
        setLoaded(true);
        setLoadedUserId(user!.id);
      } catch (err) {
        if (cancelled) return;
        console.error("Supabase yükleme hatası:", err);
        showToast(
          `Supabase verileri yüklenemedi: ${err instanceof Error ? err.message : String(err)}`,
          9000,
        );
        setLoaded(true);
        setLoadedUserId(user!.id);
      }
    }

    loadFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [authReady, generateDueFixedIncomes, showToast, user]);

  useEffect(() => {
    if (!authReady || !user) return;
    const targetUser = user;
    let cancelled = false;
    const storageKey = `fiyor-savings-goals:${targetUser.id}`;

    async function loadSavingsGoals() {
      let cachedGoals: SavingsGoal[] = [];
      try {
        const cached = localStorage.getItem(storageKey);
        if (cached) {
          const parsed: unknown = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            cachedGoals = parsed.filter(
              (goal): goal is SavingsGoal =>
                !!goal &&
                typeof goal === "object" &&
                typeof goal.id === "string" &&
                typeof goal.title === "string" &&
                typeof goal.targetAmount === "number" &&
                typeof goal.currentAmount === "number" &&
                typeof goal.createdAt === "string",
            );
          }
        }
      } catch (error) {
        console.error("Birikim hedefleri yerel depolamadan okunamadı:", error);
      }

      if (cancelled) return;
      setSavingsGoalsOwnerId(targetUser.id);
      setSavingsGoals(cachedGoals);

      const { data, error } = await supabase
        .from("savings_goals")
        .select("id,title,target_amount,current_amount,created_at")
        .eq("user_id", targetUser.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (error) {
        if (isMissingSavingsGoalsTable(error)) {
          setSavingsGoalsLocalFallbackUserId(targetUser.id);
          return;
        }
        console.error("Birikim hedefleri yükleme hatası:", error);
        showToast(`Birikim hedefleri yüklenemedi [${error.code}]: ${error.message}`, 8000);
        return;
      }

      setSavingsGoalsLocalFallbackUserId(null);
      setSavingsGoalsOwnerId(targetUser.id);
      setSavingsGoals(
        (data ?? []).map((row) => ({
          id: String(row.id),
          title: String(row.title),
          targetAmount: Number(row.target_amount),
          currentAmount: Number(row.current_amount),
          createdAt: String(row.created_at),
        })),
      );
    }

    void loadSavingsGoals();
    return () => {
      cancelled = true;
    };
  }, [authReady, showToast, user]);

  useEffect(() => {
    if (!loaded || !user || loadedUserId !== user.id) return;

    const data: PersistedState = {
      baseBalances,
      transactions,
      debts,
    };

    localStorage.setItem(`${STORAGE_KEY}:${user.id}`, JSON.stringify(data));
  }, [baseBalances, transactions, debts, loaded, loadedUserId, user]);

  function handleTransactionTypeChange(nextType: TransactionType) {
    setTxType(nextType);
    setTxIsConfirmed(nextType === "expense");
    if (nextType !== "expense") setInstallmentCount("1");
    if (nextType === "transfer") {
      setTxCategory("Transfer");
      const sourceAccount = transferSourceOptions.includes(txAccount) ? txAccount : "bank";
      if (sourceAccount !== txAccount) setTxAccount(sourceAccount);
      if (sourceAccount === txTransferTarget) {
        setTxTransferTarget(sourceAccount === "cash" ? "bank" : "cash");
      }
      return;
    }

    const nextCategories = nextType === "income" ? incomeCategories : expenseCategories;
    if (!nextCategories.includes(txCategory)) {
      setTxCategory(nextCategories[0]);
    }
  }

  function handleEditTransactionTypeChange(nextType: TransactionType) {
    setEditType(nextType);
    if (nextType === "transfer") {
      setEditCategory("Transfer");
      const sourceAccount = transferSourceOptions.includes(editTransferSource)
        ? editTransferSource
        : "bank";
      if (sourceAccount !== editTransferSource) setEditTransferSource(sourceAccount);
      if (sourceAccount === editTransferTarget) {
        setEditTransferTarget(sourceAccount === "cash" ? "bank" : "cash");
      }
      return;
    }

    const nextCategories = nextType === "income" ? incomeCategories : expenseCategories;
    if (!nextCategories.includes(editCategory)) {
      setEditCategory(nextCategories[0]);
    }
  }

  const balances = useMemo(
    () => calculateBalances(baseBalances, transactions),
    [baseBalances, transactions],
  );

  const currentMonth = analysisReferenceDate.slice(0, 7);
  const currentSpendMonth = todayInputValue().slice(0, 7);
  const monthlyExpenseTotal = useMemo(
    () =>
      transactions.reduce(
        (total, item) =>
          item.type === "expense" &&
          Number.isFinite(item.amount) &&
          item.category !== "Kredi Kartı Ödemesi" &&
          item.date.slice(0, 7) === currentSpendMonth
            ? total + item.amount
            : total,
        0,
      ),
    [currentSpendMonth, transactions],
  );
  const reminderDates = useMemo(() => {
    const todayKey = todayInputValue();
    const today = parseLocalDateKey(todayKey);
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 35);
    const reminders: DashboardReminder[] = [];

    function addReminder(
      key: string,
      date: Date,
      title: string,
      body: string,
      kind: DashboardReminder["kind"],
      amount?: number,
    ) {
      const dateKey = localDateKey(date);
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0);
      reminders.push({
        id: key,
        key,
        dateKey,
        dateLabel: reminderDateLabel(date, today),
        title,
        body,
        at,
        kind,
        amount,
      });
    }

    if (reminderSettings.enabled && reminderSettingsReadyUserId === user?.id) {
      for (const income of fixedIncomes) {
        for (const date of monthlyOccurrences(income.dayOfMonth, today, 35)) {
          if (date > endDate) continue;
          addReminder(
            `fixed:${income.id}:${localDateKey(date)}`,
            date,
            income.type === "income" ? "Sabit gelir" : "Sabit gider",
            income.title,
            "fixed",
            income.amount,
          );
        }
      }

      for (const [label, day, id] of [
        ["Kredi kartı hesap kesim günü", reminderSettings.statementDay, "statement"],
        ["Kredi kartı son ödeme günü", reminderSettings.dueDay, "due"],
      ] as const) {
        if (day === null) continue;
        for (const dueDate of monthlyOccurrences(day, today, 35)) {
          if (dueDate > endDate) continue;
          const reminderDate = new Date(
            dueDate.getFullYear(),
            dueDate.getMonth(),
            dueDate.getDate() - 3,
          );
          if (reminderDate >= today) {
            addReminder(
              `card:${id}:early:${localDateKey(dueDate)}`,
              reminderDate,
              label,
              `3 gün sonra · Ayın ${dueDate.getDate()}. günü`,
              "card",
            );
          }
          addReminder(
            `card:${id}:${localDateKey(dueDate)}`,
            dueDate,
            label,
            `Son gün · Ayın ${dueDate.getDate()}. günü`,
            "card",
          );
        }
      }
    }

    if (reminderSettings.enabled && reminderSettingsReadyUserId === user?.id) {
      const currentBalances = calculateBalances(baseBalances, transactions);
      for (const [account, label] of [
        ["cash", "Nakit"],
        ["bank", "Banka"],
        ["benefit", "Yan Hak"],
        ["savings", "Birikim"],
        ["creditDebt", "Kredi kartı borcu"],
      ] as const) {
        if (currentBalances[account] < 0) {
          addReminder(
            `balance:${account}`,
            today,
            "Eksi bakiye uyarısı",
            `${label} bakiyesi eksiye düştü.`,
            "balance",
          );
        }
      }
    }

    if (
      reminderSettings.enabled &&
      reminderSettingsReadyUserId === user?.id &&
      monthlyLimit !== null &&
      monthlyLimit > 0 &&
      (monthlyExpenseTotal / monthlyLimit) * 100 >= 85
    ) {
      const date = parseLocalDateKey(todayKey);
      const percentage = Math.floor((monthlyExpenseTotal / monthlyLimit) * 100);
      addReminder(
        `limit:${todayKey.slice(0, 7)}`,
        date,
        percentage >= 100 ? "Aylık limit aşıldı" : "Aylık limite yaklaşıyorsun",
        `Fiyort Barı doluluğu %${percentage}.`,
        "limit",
      );
    }

    return reminders.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [
    baseBalances,
    fixedIncomes,
    monthlyExpenseTotal,
    monthlyLimit,
    reminderSettings,
    reminderSettingsReadyUserId,
    transactions,
    user?.id,
  ]);
  const activeReminders = useMemo(
    () =>
      reminderDates.filter((reminder) => {
        if (daysBetweenLocalDates(parseLocalDateKey(todayInputValue()), parseLocalDateKey(reminder.dateKey)) > 3) {
          return false;
        }
        const month = reminder.dateKey.slice(0, 7);
        return !(dismissedRemindersByMonth[month] ?? []).includes(reminder.id);
      }),
    [dismissedRemindersByMonth, reminderDates],
  );
  const scheduledReminders = useMemo(
    () =>
      reminderDates.filter((reminder) => {
        const month = reminder.dateKey.slice(0, 7);
        return !(dismissedRemindersByMonth[month] ?? []).includes(reminder.id);
      }),
    [dismissedRemindersByMonth, reminderDates],
  );
  const scheduledRemindersRef = useRef(scheduledReminders);

  useEffect(() => {
    userRef.current = user;
    reminderSettingsRef.current = reminderSettings;
    scheduledRemindersRef.current = scheduledReminders;
  }, [reminderSettings, scheduledReminders, user]);

  useEffect(() => {
    if (!user || !loaded || loadedUserId !== user.id || reminderSettingsReadyUserId !== user.id) {
      return;
    }

    void synchronizeLocalNotifications(
      user.id,
      scheduledReminders,
      reminderSettings.enabled,
    )
      .then((result) => {
        if (result.status === "permission-denied") {
          showToast("Cihaz bildirim izni kapalı. Hatırlatmalar uygulama içinde görünür.");
        }
      })
      .catch((error: unknown) => {
        console.error("Yerel hatırlatmalar zamanlanamadı:", error);
        showToast(
          `Yerel hatırlatmalar zamanlanamadı: ${error instanceof Error ? error.message : String(error)}`,
          7000,
        );
      });
  }, [
    loaded,
    loadedUserId,
    reminderSettings.enabled,
    reminderSettingsReadyUserId,
    scheduledReminders,
    showToast,
    user,
  ]);

  useEffect(() => {
    if (
      !user ||
      !loaded ||
      loadedUserId !== user.id ||
      reminderSettingsReadyUserId !== user.id ||
      !reminderSettings.enabled ||
      permissionRequestedUserIdRef.current === user.id
    ) {
      return;
    }

    permissionRequestedUserIdRef.current = user.id;
    void requestLocalNotificationPermission()
      .then((permission) => {
        if (
          permission !== true ||
          !reminderSettingsRef.current.enabled ||
          userRef.current?.id !== user.id
        ) {
          return;
        }
        return synchronizeLocalNotifications(
          user.id,
          scheduledRemindersRef.current,
          true,
        );
      })
      .catch((error: unknown) => {
        console.warn("Yerel bildirim izni kontrol edilemedi:", error);
      });
  }, [
    loaded,
    loadedUserId,
    reminderSettings.enabled,
    reminderSettingsReadyUserId,
    scheduledReminders,
    user,
  ]);

  useEffect(() => {
    if (!user || !loaded || loadedUserId !== user.id || reminderSettingsReadyUserId !== user.id) {
      return;
    }

    const userId = user.id;
    const notificationsEnabled = reminderSettings.enabled;
    const reminders = scheduledReminders;
    const synchronizeForVisibility = () => {
      void synchronizeLocalNotifications(userId, reminders, notificationsEnabled).catch(
        (error: unknown) => {
          console.error("Uygulama durumu değişince hatırlatmalar eşitlenemedi:", error);
        },
      );
    };
    const cleanWhileForeground = () => {
      if (document.visibilityState !== "visible") return;
      void cleanNearOrExpiredLocalNotifications(userId).catch((error: unknown) => {
        console.error("Yakın zamanlı bildirimler temizlenemedi:", error);
      });
    };

    document.addEventListener("visibilitychange", synchronizeForVisibility);
    window.addEventListener("focus", synchronizeForVisibility);
    const safetyInterval = window.setInterval(cleanWhileForeground, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", synchronizeForVisibility);
      window.removeEventListener("focus", synchronizeForVisibility);
      window.clearInterval(safetyInterval);
    };
  }, [
    loaded,
    loadedUserId,
    reminderSettings.enabled,
    reminderSettingsReadyUserId,
    scheduledReminders,
    user,
  ]);

  useEffect(() => {
    const previousUserId = notificationUserIdRef.current;
    const nextUserId = user?.id ?? null;
    if (previousUserId && previousUserId !== nextUserId) {
      void synchronizeLocalNotifications(previousUserId, [], false).catch((error: unknown) => {
        console.error("Önceki kullanıcı bildirimleri temizlenemedi:", error);
      });
    }
    notificationUserIdRef.current = nextUserId;
  }, [user?.id]);

  useEffect(() => {
    if (!notificationCenterOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationCenterOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [notificationCenterOpen]);

  useEffect(() => {
    if (!xlUpgradeOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setXLUpgradeOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [xlUpgradeOpen]);

  const openingNetEntry =
    baseBalances.cash +
    baseBalances.bank +
    baseBalances.savings -
    baseBalances.creditDebt;

  const analysisReferenceMonth = analysisReferenceDate.slice(0, 7);
  const effectiveAnalysisDateFilter = isPlanRestricted ? "month" : analysisDateFilter;
  const effectiveSelectedMonth = isPlanRestricted ? currentMonth : selectedMonth;
  const isForecastView = effectiveAnalysisDateFilter.startsWith("future-");
  const isCustomAnalysisRangeValid = Boolean(
    customRangeStart && customRangeEnd && customRangeStart <= customRangeEnd,
  );
  const analysisRange = useMemo(() => {
    if (effectiveAnalysisDateFilter === "month") {
      return effectiveSelectedMonth
        ? { start: `${effectiveSelectedMonth}-01`, end: endOfMonth(effectiveSelectedMonth) }
        : { start: null, end: null };
    }
    if (effectiveAnalysisDateFilter === "all") return { start: null, end: null };
    if (effectiveAnalysisDateFilter === "custom") {
      return { start: customRangeStart, end: customRangeEnd };
    }

    const count = Number(effectiveAnalysisDateFilter.split("-")[1]);
    if (effectiveAnalysisDateFilter.startsWith("past-")) {
      const startMonth = shiftMonth(analysisReferenceMonth, -(count - 1));
      return { start: `${startMonth}-01`, end: endOfMonth(analysisReferenceMonth) };
    }

    const firstFutureMonth = shiftMonth(analysisReferenceMonth, 1);
    const endMonth = shiftMonth(analysisReferenceMonth, count);
    return { start: `${firstFutureMonth}-01`, end: endOfMonth(endMonth) };
  }, [
    effectiveAnalysisDateFilter,
    analysisReferenceMonth,
    customRangeEnd,
    customRangeStart,
    effectiveSelectedMonth,
  ]);

  const analysisTransactions = useMemo(() => {
    if (effectiveAnalysisDateFilter === "custom" && !isCustomAnalysisRangeValid) return [];

    const inRange = (date: string) =>
      (!analysisRange.start || date >= analysisRange.start) &&
      (!analysisRange.end || date <= analysisRange.end);
    const matchingTransactions = transactions.filter((item) => {
      if (isXL && item.isSystemXL) return false;
      if (
        !isForecastView &&
        effectiveAnalysisDateFilter !== "custom" &&
        item.type !== "transfer" &&
        !item.isConfirmed
      ) {
        return false;
      }
      return inRange(item.date);
    });

    if (!isForecastView) return matchingTransactions;

    const existingFixedOccurrences = new Set(
      transactions
        .filter((item) => item.fixedIncomeId && item.generatedMonth)
        .map((item) => `${item.fixedIncomeId}:${item.generatedMonth}`),
    );
    const projectedFixedIncomes: Transaction[] = [];
    for (let offset = 0; offset < Number(effectiveAnalysisDateFilter.split("-")[1]); offset += 1) {
      const month = shiftMonth(analysisReferenceMonth, offset + 1);
      const [year, monthNumber] = month.split("-").map(Number);
      const lastDay = new Date(year, monthNumber, 0).getDate();
      for (const income of fixedIncomes) {
        if (existingFixedOccurrences.has(`${income.id}:${month}`)) continue;
        const date = `${month}-${String(Math.min(income.dayOfMonth, lastDay)).padStart(2, "0")}`;
        if (!inRange(date)) continue;
        projectedFixedIncomes.push({
          id: `forecast:${income.id}:${month}`,
          date,
          type: income.type,
          account: income.account,
          fixedIncomeId: income.id,
          generatedMonth: month,
          category: income.title,
          amount: income.amount,
          note: "Sabit işlem öngörüsü",
          createdAt: income.createdAt,
          isConfirmed: true,
          source: "manual",
        });
      }
    }
    return [...matchingTransactions, ...projectedFixedIncomes];
  }, [
    effectiveAnalysisDateFilter,
    isCustomAnalysisRangeValid,
    analysisRange.end,
    analysisRange.start,
    analysisReferenceMonth,
    fixedIncomes,
    isXL,
    isForecastView,
    transactions,
  ]);

  const transactionSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let transactionCount = 0;

    for (const item of analysisTransactions) {
      if (item.type === "income") totalIncome += item.amount;
      if (item.type === "expense") totalExpense += item.amount;
      if (item.type === "expense" || item.isConfirmed) transactionCount += 1;
    }

    return {
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
      transactionCount,
    };
  }, [analysisTransactions]);

  const totalExpenseIncludingOpeningDebt =
    transactionSummary.totalExpense + (isForecastView ? 0 : baseBalances.creditDebt);

  const categoryData = useMemo(() => {
    const grouped: Record<string, number> = {};

    for (const item of analysisTransactions) {
      if (item.type !== "expense") continue;
      grouped[item.category] = (grouped[item.category] ?? 0) + item.amount;
    }

    return Object.entries(grouped)
      .map(([category, total], index) => ({
        category,
        total,
        color: expenseCategoryColors[category] ?? chartColors[index % chartColors.length],
      }))
      .sort((a, b) => b.total - a.total);
  }, [analysisTransactions]);

  const smartSummaryItems = useMemo(() => {
    const items: string[] = [];
    const topExpenseCategory = categoryData[0];

    if (transactionSummary.netFlow > 0) {
      items.push(
        `Bu dönemde gelirlerin giderlerinden yüksek. Net olarak +${formatMoney(transactionSummary.netFlow, privacyMode)} ileridesin.`,
      );
    } else if (transactionSummary.netFlow < 0) {
      items.push(
        `Bu dönemde giderlerin gelirlerinden yüksek. Net olarak -${formatMoney(Math.abs(transactionSummary.netFlow), privacyMode)} geridesin.`,
      );
    } else {
      items.push(`Bu dönemde gelir ve giderlerin dengede. Net durum ${formatMoney(0, privacyMode)}.`);
    }

    if (topExpenseCategory) {
      items.push(
        `En çok harcama yaptığın kategori: ${topExpenseCategory.category} (${formatMoney(topExpenseCategory.total, privacyMode)}).`,
      );
    }

    if (transactionSummary.totalIncome === 0) {
      items.push("Bu dönemde gelir kaydı görünmüyor.");
    }

    if (transactionSummary.totalExpense === 0) {
      items.push("Bu dönemde gider kaydı görünmüyor.");
    }

    return items;
  }, [categoryData, privacyMode, transactionSummary.netFlow, transactionSummary.totalExpense, transactionSummary.totalIncome]);

  const incomeData = useMemo(() => {
    const grouped: Record<string, number> = {};

    for (const item of analysisTransactions) {
      if (item.type !== "income") continue;
      grouped[item.category] = (grouped[item.category] ?? 0) + item.amount;
    }

    return Object.entries(grouped)
      .map(([category, total]) => ({
        category,
        total,
        color: pieIncomeCategoryColors[category] ?? "#22c55e",
      }))
      .sort((a, b) => b.total - a.total);
  }, [analysisTransactions]);

  const monthlyFlowData = useMemo(() => {
    const grouped: Record<
      string,
      {
        month: string;
        income: number;
        expense: number;
        net: number;
        categoryTotals: Record<string, number>;
      }
    > = {};

    for (const item of analysisTransactions) {
      const month = item.date.slice(0, 7);

      if (!grouped[month]) {
        grouped[month] = {
          month,
          income: 0,
          expense: 0,
          net: 0,
          categoryTotals: {},
        };
      }

      if (item.type === "income") {
        grouped[month].income += item.amount;
      }
      if (item.type === "expense") {
        grouped[month].expense += item.amount;
        grouped[month].categoryTotals[item.category] =
          (grouped[month].categoryTotals[item.category] ?? 0) + item.amount;
      }

      grouped[month].net = grouped[month].income - grouped[month].expense;
    }

    return Object.values(grouped)
      .map((item) => {
        const topCategoryEntry = Object.entries(item.categoryTotals).sort(
          (a, b) => b[1] - a[1],
        )[0];

        return {
          ...item,
          topCategory: topCategoryEntry?.[0] ?? "-",
          topCategoryTotal: topCategoryEntry?.[1] ?? 0,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [analysisTransactions]);

  const insightItems = useMemo(() => {
    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};
    const incomeByDay: Record<string, number> = {};
    const expenseByDay: Record<string, number> = {};
    let totalAmount = 0;
    let highestTransaction: Transaction | undefined;

    for (const item of analysisTransactions) {
      totalAmount += item.amount;
      if (!highestTransaction || item.amount > highestTransaction.amount) {
        highestTransaction = item;
      }

      if (item.type === "income") {
        incomeByCategory[item.category] = (incomeByCategory[item.category] ?? 0) + item.amount;
        incomeByDay[item.date] = (incomeByDay[item.date] ?? 0) + item.amount;
      }

      if (item.type === "expense") {
        expenseByCategory[item.category] = (expenseByCategory[item.category] ?? 0) + item.amount;
        expenseByDay[item.date] = (expenseByDay[item.date] ?? 0) + item.amount;
      }
    }

    const topEntry = (entries: Record<string, number>) =>
      Object.entries(entries).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))[0];

    const topIncomeCategory = topEntry(incomeByCategory);
    const topExpenseCategory = topEntry(expenseByCategory);
    const topExpenseDay = topEntry(expenseByDay);
    const topIncomeDay = topEntry(incomeByDay);
    const averageAmount =
      analysisTransactions.length > 0 ? totalAmount / analysisTransactions.length : 0;
    const incomeExpenseRatio =
      transactionSummary.totalExpense > 0
        ? formatPercent((transactionSummary.totalIncome / transactionSummary.totalExpense) * 100)
        : transactionSummary.totalIncome > 0
          ? "∞%"
          : "%0";

    return [
      {
        label: "En yüksek gelir kategorisi",
        value: topIncomeCategory
          ? `${topIncomeCategory[0]} / ${formatMoney(topIncomeCategory[1], privacyMode)}`
          : "-",
        tone: "income",
      },
      {
        label: "En yüksek gider kategorisi",
        value: topExpenseCategory
          ? `${topExpenseCategory[0]} / ${formatMoney(topExpenseCategory[1], privacyMode)}`
          : "-",
        tone: "expense",
      },
      {
        label: "Toplam işlem sayısı",
        value: String(analysisTransactions.length),
        tone: "count",
      },
      {
        label: "Ortalama işlem tutarı",
        value: formatMoney(averageAmount, privacyMode),
        tone: "average",
      },
      {
        label: "Gelir / Gider oranı",
        value: incomeExpenseRatio,
        tone: "ratio",
      },
      {
        label: "En yüksek tek işlem",
        value: highestTransaction
          ? `${highestTransaction.category} / ${formatMoney(highestTransaction.amount, privacyMode)}`
          : "-",
        tone: "peak",
      },
      {
        label: "En yoğun harcama günü",
        value: topExpenseDay ? `${formatDate(topExpenseDay[0])} / ${formatMoney(topExpenseDay[1], privacyMode)}` : "-",
        tone: "expense",
      },
      {
        label: "En yoğun gelir günü",
        value: topIncomeDay ? `${formatDate(topIncomeDay[0])} / ${formatMoney(topIncomeDay[1], privacyMode)}` : "-",
        tone: "income",
      },
    ];
  }, [analysisTransactions, privacyMode, transactionSummary.totalExpense, transactionSummary.totalIncome]);

  const trendAnalysis = useMemo(() => {
    if (effectiveAnalysisDateFilter !== "month") {
      return {
        hasComparison: false,
        message: isForecastView
          ? "Tahmini dönem görünümünde geçmiş ay trendi gösterilmez."
          : "Seçilen tarih aralığında aylık karşılaştırma gösterilmez.",
        metricTrends: null,
        items: [],
      };
    }

    const range = getTrendComparisonRange(effectiveSelectedMonth);

    if (!range) {
      return {
        hasComparison: false,
        message: "Tümü seçiliyken aylık karşılaştırma yok. Bir ay seçerek önceki ay trendini gör.",
        metricTrends: null,
        items: [],
      };
    }

    const previousTransactions = transactions.filter((item) => {
      if (item.type !== "transfer" && !item.isConfirmed) return false;
      if (item.date < range.previousStart) return false;
      if (item.date > range.previousEnd) return false;
      return true;
    });

    if (previousTransactions.length === 0) {
      return {
        hasComparison: false,
        message: "Karşılaştırma için yeterli geçmiş veri bulunamadı.",
        metricTrends: null,
        items: [],
      };
    }

    const currentSummary = summarizeTransactions(analysisTransactions);
    const previousSummary = summarizeTransactions(previousTransactions);
    const categoryNames = new Set([
      ...Object.keys(currentSummary.expenseByCategory),
      ...Object.keys(previousSummary.expenseByCategory),
    ]);
    let topIncreasedExpense: { category: string; diff: number } | undefined;
    let topDecreasedExpense: { category: string; diff: number } | undefined;

    for (const category of categoryNames) {
      const diff =
        (currentSummary.expenseByCategory[category] ?? 0) -
        (previousSummary.expenseByCategory[category] ?? 0);

      if (diff > 0 && (!topIncreasedExpense || diff > topIncreasedExpense.diff)) {
        topIncreasedExpense = { category, diff };
      }
      if (diff < 0 && (!topDecreasedExpense || diff < topDecreasedExpense.diff)) {
        topDecreasedExpense = { category, diff };
      }
    }

    const netDiff = currentSummary.netFlow - previousSummary.netFlow;
    const transactionDiff = currentSummary.transactionCount - previousSummary.transactionCount;
    const transactionCountTrend = getMetricTrend(
      currentSummary.transactionCount,
      previousSummary.transactionCount,
    );

    return {
      hasComparison: true,
      message: "",
      metricTrends: {
        income: getMetricTrend(currentSummary.totalIncome, previousSummary.totalIncome),
        expense: getMetricTrend(
          currentSummary.totalExpense + baseBalances.creditDebt,
          previousSummary.totalExpense + baseBalances.creditDebt,
          true,
        ),
        net: getMetricTrend(currentSummary.netFlow, previousSummary.netFlow),
        count: { ...transactionCountTrend, tone: "neutral" as const },
      },
      items: [
        {
          label: "Gelir değişimi",
          value: formatTrendPercent(currentSummary.totalIncome, previousSummary.totalIncome),
          detail: buildTrendLabel(currentSummary.totalIncome, previousSummary.totalIncome, "Gelir arttı", "Gelir azaldı"),
          tone: getTrendTone(currentSummary.totalIncome, previousSummary.totalIncome),
        },
        {
          label: "Gider değişimi",
          value: formatTrendPercent(currentSummary.totalExpense, previousSummary.totalExpense),
          detail: buildTrendLabel(currentSummary.totalExpense, previousSummary.totalExpense, "Gider arttı", "Gider azaldı"),
          tone: getTrendTone(previousSummary.totalExpense, currentSummary.totalExpense),
        },
        {
          label: "Net durum değişimi",
          value: formatSignedMoney(netDiff, privacyMode),
          detail: buildTrendLabel(currentSummary.netFlow, previousSummary.netFlow, "Net durum iyileşti", "Net durum geriledi"),
          tone: getTrendTone(currentSummary.netFlow, previousSummary.netFlow),
        },
        {
          label: "En çok artan gider kategorisi",
          value: topIncreasedExpense
            ? `${topIncreasedExpense.category} / +${formatMoney(topIncreasedExpense.diff, privacyMode)}`
            : "-",
          detail: topIncreasedExpense ? "Önceki döneme göre artış" : "Artan kategori yok",
          tone: topIncreasedExpense ? "negative" : "neutral",
        },
        {
          label: "En çok azalan gider kategorisi",
          value: topDecreasedExpense
            ? `${topDecreasedExpense.category} / -${formatMoney(Math.abs(topDecreasedExpense.diff), privacyMode)}`
            : "-",
          detail: topDecreasedExpense ? "Önceki döneme göre azalış" : "Azalan kategori yok",
          tone: topDecreasedExpense ? "positive" : "neutral",
        },
        {
          label: "İşlem sayısı değişimi",
          value: `${transactionDiff > 0 ? "+" : ""}${transactionDiff}`,
          detail: `${formatTrendPercent(currentSummary.transactionCount, previousSummary.transactionCount)} değişim`,
          tone: "neutral",
        },
      ],
    };
  }, [
    effectiveAnalysisDateFilter,
    analysisTransactions,
    baseBalances.creditDebt,
    isForecastView,
    privacyMode,
    effectiveSelectedMonth,
    transactions,
  ]);

  const analysisMetricTrends = trendAnalysis.metricTrends ?? {
    income: getFallbackTrend(
      transactionSummary.totalIncome > 0 ? "Bu dönemde aktif" : "Gelir kaydı yok",
    ),
    expense: getFallbackTrend(
      transactionSummary.totalIncome > 0
        ? `${formatPercent(
            (totalExpenseIncludingOpeningDebt / transactionSummary.totalIncome) * 100,
          )} gelire göre harcama`
        : transactionSummary.totalExpense > 0
          ? "Gelir kaydı yok"
          : "Bu dönemde gider yok",
    ),
    net: getFallbackTrend(
      transactionSummary.netFlow === 0
        ? "Gelir ve gider dengede"
        : "Bu dönemde aktif",
    ),
    count: getFallbackTrend(
      transactionSummary.transactionCount > 0
        ? `${transactionSummary.transactionCount} işlem bu dönemde`
        : "Henüz işlem yok",
    ),
  };

  const sortedTransactions = useMemo(() => {
    const monthTransactions = selectedMonth
      ? transactions.filter((item) => item.date.slice(0, 7) === selectedMonth)
      : transactions;
    const sorted = monthTransactions
      .filter((item) => !(isXL && item.isSystemXL))
      .sort(sortByDateNewest);
    if (historyFilter === "pending") {
      return sorted.filter(
        (item) => item.isSystemXL || (item.type !== "transfer" && !item.isConfirmed),
      );
    }
    if (historyFilter === "all") return sorted;
    return sorted.filter((item) => item.isSystemXL || item.type === historyFilter);
  }, [historyFilter, isXL, selectedMonth, transactions]);

  const activeSavingsGoals =
    savingsGoalsOwnerId === user?.id ? savingsGoals : [];
  const usesLocalSavingsGoals = Boolean(
    user && savingsGoalsLocalFallbackUserId === user.id,
  );

  function persistLocalSavingsGoals(nextGoals: SavingsGoal[]) {
    if (!user) return false;
    try {
      localStorage.setItem(`fiyor-savings-goals:${user.id}`, JSON.stringify(nextGoals));
      return true;
    } catch (error) {
      console.error("Birikim hedefleri yerel depolamaya yazılamadı:", error);
      showToast("Birikim hedefleri yerel depolamaya kaydedilemedi.", 7000);
      return false;
    }
  }

  async function addSavingsGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;

    const targetAmount = parseAmountInput(savingsGoalTarget);
    const currentAmount = parseAmountInput(savingsGoalInitial || "0");
    const title = savingsGoalTitle.trim();
    if (!title || !Number.isFinite(targetAmount) || targetAmount <= 0) {
      showToast("Hedef adı ve sıfırdan büyük bir hedef tutarı gir.");
      return;
    }
    if (!Number.isFinite(currentAmount) || currentAmount < 0) {
      showToast("Başlangıç tutarı sıfır veya daha büyük olmalı.");
      return;
    }

    const newGoal: SavingsGoal = {
      id: createId("goal"),
      title,
      targetAmount,
      currentAmount,
      createdAt: new Date().toISOString(),
    };
    const nextGoals = [...activeSavingsGoals, newGoal];
    setSavingGoal(true);

    if (usesLocalSavingsGoals) {
      if (persistLocalSavingsGoals(nextGoals)) {
        setSavingsGoals(nextGoals);
        setSavingsGoalModalOpen(false);
        setSavingsGoalTitle("");
        setSavingsGoalTarget("");
        setSavingsGoalInitial("");
      }
      setSavingGoal(false);
      return;
    }

    const { data, error } = await supabase
      .from("savings_goals")
      .insert({
        id: newGoal.id,
        user_id: user.id,
        title: newGoal.title,
        target_amount: newGoal.targetAmount,
        current_amount: newGoal.currentAmount,
      })
      .select("id,title,target_amount,current_amount,created_at")
      .single();

    if (error) {
      if (isMissingSavingsGoalsTable(error)) {
        setSavingsGoalsLocalFallbackUserId(user.id);
        if (persistLocalSavingsGoals(nextGoals)) {
          setSavingsGoals(nextGoals);
          setSavingsGoalModalOpen(false);
          setSavingsGoalTitle("");
          setSavingsGoalTarget("");
          setSavingsGoalInitial("");
        }
      } else {
        console.error("Birikim hedefi ekleme hatası:", error);
        showToast(`Birikim hedefi eklenemedi [${error.code}]: ${error.message}`, 8000);
      }
    } else {
      setSavingsGoals((current) => [
        ...current,
        {
          id: String(data.id),
          title: String(data.title),
          targetAmount: Number(data.target_amount),
          currentAmount: Number(data.current_amount),
          createdAt: String(data.created_at),
        },
      ]);
      setSavingsGoalModalOpen(false);
      setSavingsGoalTitle("");
      setSavingsGoalTarget("");
      setSavingsGoalInitial("");
    }
    setSavingGoal(false);
  }

  async function addSavingsGoalContribution(goalId: string) {
    if (!user) return;
    const contribution = parseAmountInput(goalContributionDraft);
    const goal = activeSavingsGoals.find((item) => item.id === goalId);
    if (!goal || !Number.isFinite(contribution) || contribution <= 0) {
      showToast("Eklenecek tutar sıfırdan büyük olmalı.");
      return;
    }

    const updatedGoal = { ...goal, currentAmount: goal.currentAmount + contribution };
    const nextGoals = activeSavingsGoals.map((item) =>
      item.id === goalId ? updatedGoal : item,
    );
    setSavingGoal(true);

    if (usesLocalSavingsGoals) {
      if (persistLocalSavingsGoals(nextGoals)) {
        setSavingsGoals(nextGoals);
        setGoalContributionId(null);
        setGoalContributionDraft("");
      }
      setSavingGoal(false);
      return;
    }

    const { error } = await supabase
      .from("savings_goals")
      .update({ current_amount: updatedGoal.currentAmount })
      .eq("id", goalId)
      .eq("user_id", user.id);

    if (error) {
      if (isMissingSavingsGoalsTable(error)) {
        setSavingsGoalsLocalFallbackUserId(user.id);
        if (persistLocalSavingsGoals(nextGoals)) {
          setSavingsGoals(nextGoals);
          setGoalContributionId(null);
          setGoalContributionDraft("");
        }
      } else {
        console.error("Birikim hedefi güncelleme hatası:", error);
        showToast(`Birikime tutar eklenemedi [${error.code}]: ${error.message}`, 8000);
      }
    } else {
      setSavingsGoals(nextGoals);
      setGoalContributionId(null);
      setGoalContributionDraft("");
    }
    setSavingGoal(false);
  }

  async function deleteSavingsGoal(goalId: string) {
    if (!user) return;
    const nextGoals = activeSavingsGoals.filter((goal) => goal.id !== goalId);
    setDeletingGoal(true);

    if (usesLocalSavingsGoals) {
      if (persistLocalSavingsGoals(nextGoals)) {
        setSavingsGoals(nextGoals);
        setPendingDeleteGoalId(null);
      }
      setDeletingGoal(false);
      return;
    }

    const { error } = await supabase
      .from("savings_goals")
      .delete()
      .eq("id", goalId)
      .eq("user_id", user.id);

    if (error) {
      if (isMissingSavingsGoalsTable(error)) {
        setSavingsGoalsLocalFallbackUserId(user.id);
        if (persistLocalSavingsGoals(nextGoals)) {
          setSavingsGoals(nextGoals);
          setPendingDeleteGoalId(null);
        }
      } else {
        console.error("Birikim hedefi silme hatası:", error);
        showToast(`Birikim hedefi silinemedi [${error.code}]: ${error.message}`, 8000);
      }
    } else {
      setSavingsGoals(nextGoals);
      setPendingDeleteGoalId(null);
    }
    setDeletingGoal(false);
  }

  function updateBaseBalance(key: keyof BaseBalances, rawValue: string) {
    if (!user) return;
    const parsed = parseAmountInput(rawValue);
    const safeValue = Number.isFinite(parsed) ? parsed : 0;

    setBaseBalances((current) => {
      const next = {
        ...current,
        [key]: safeValue,
      };

      supabase
        .from("base_balances")
        .upsert({
          user_id: user.id,
          cash: next.cash,
          bank: next.bank,
          benefit: next.benefit,
          savings: next.savings,
          credit_debt: next.creditDebt,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.error("Bakiye güncelleme hatası:", error);
        });

      return next;
    });
  }

  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (
      isPlanRestricted &&
      txType === "expense" &&
      txAccount === "creditCard" &&
      Number(installmentCount) > 1
    ) {
      openXLUpgrade();
      return;
    }

    const amount = parseAmountInput(txAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Tutar 0'dan büyük olmalı.");
      return;
    }

    if (txType !== "transfer" && !txCategory.trim()) {
      alert("Bir kategori gir veya hızlı kategori seç.");
      return;
    }

    if (txType === "transfer" && txAccount === txTransferTarget) {
      alert("Kaynak ve hedef hesap aynı olamaz.");
      return;
    }

    const transactionDate = txDate || todayInputValue();
    const isInstallmentPurchase =
      txType === "expense" && txAccount === "creditCard" && Number(installmentCount) > 1;
    const count = isInstallmentPurchase ? Number(installmentCount) : 1;
    const totalCents = Math.round(amount * 100);
    const baseCents = Math.floor(totalCents / count);
    if (isInstallmentPurchase && baseCents < 1) {
      showToast("Tutar, seçilen taksit sayısına bölünemeyecek kadar küçük.");
      return;
    }
    const firstInstallmentCents = baseCents + (totalCents - baseCents * count);
    const createdAt = new Date().toISOString();
    const newTransactions: Transaction[] = Array.from({ length: count }, (_, index) => {
      const installmentAmount =
        count > 1
          ? (index === 0 ? firstInstallmentCents : baseCents) / 100
          : amount;
      const installmentNote = isInstallmentPurchase
        ? [
            txNote.trim(),
            `Taksit ${index + 1}/${count}`,
          ]
            .filter(Boolean)
            .join(" · ")
        : txNote.trim();

      return {
        id: createId("tx"),
        date: index === 0 ? transactionDate : addMonthsToDate(transactionDate, index),
        type: txType,
        account: txAccount,
        toAccount: txType === "transfer" ? txTransferTarget : undefined,
        category: txType === "transfer" ? "Transfer" : txCategory.trim(),
        amount: installmentAmount,
        note: installmentNote,
        createdAt,
        isConfirmed:
          txType === "transfer" ||
          (isInstallmentPurchase
            ? index === 0 && transactionDate <= todayInputValue()
            : txIsConfirmed && transactionDate <= todayInputValue()),
        source: "manual",
      };
    });

    if (isPlanRestricted) {
      const monthCounts = new Map<string, number>();
      for (const transaction of transactions) {
        const month = transaction.date.slice(0, 7);
        monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      }
      const affectedMonths = new Set<string>();
      for (const transaction of newTransactions) {
        const month = transaction.date.slice(0, 7);
        affectedMonths.add(month);
        monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      }
      if ([...affectedMonths].some((month) => (monthCounts.get(month) ?? 0) > 3)) {
        openXLUpgrade();
        showToast("L Plan'da her ay en fazla 3 işlem eklenebilir.");
        return;
      }
    }

    const { error } = await supabase.from("transactions").insert(
      newTransactions.map((transaction) => ({
        id: transaction.id,
        user_id: user.id,
        date: transaction.date,
        type: transaction.type,
        account: transaction.account,
        category: transaction.category,
        amount: transaction.amount,
        note: transaction.note,
        created_at: transaction.createdAt,
        is_confirmed: transaction.isConfirmed,
        source: transaction.source,
        ...(transaction.type === "transfer"
          ? { to_account: transaction.toAccount }
          : {}),
      })),
    );

    if (error) {
      console.error("İşlem ekleme hatası:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      showToast(`İşlem kaydedilemedi [${error.code}]: ${error.message}`, 8000);
    } else {
      setTransactions((current) => [...newTransactions, ...current]);
      setTxAmount("");
      setTxNote("");
      setTxDate(todayInputValue());
      setTxIsConfirmed(txType === "expense");
      setInstallmentCount("1");
      setActiveTab("history");
      showToast(
        isInstallmentPurchase
          ? `${count} taksitli işlem eklendi.`
          : txType === "transfer"
            ? "Transfer eklendi."
            : "İşlem eklendi.",
      );
    }
  }

  async function updateTransactionConfirmation(transactionId: string, isConfirmed: boolean) {
    if (!user) return;

    const transaction = transactions.find((item) => item.id === transactionId);
    if (
      !transaction ||
      transaction.type === "transfer" ||
      transaction.isConfirmed === isConfirmed
    ) {
      return;
    }

    setTransactions((current) =>
      current.map((item) =>
        item.id === transactionId ? { ...item, isConfirmed } : item,
      ),
    );

    const { error } = await supabase
      .from("transactions")
      .update({ is_confirmed: isConfirmed })
      .eq("id", transactionId)
      .eq("user_id", user.id);

    if (error) {
      console.error("İşlem ödeme durumu güncelleme hatası:", error);
    } else {
      showToast(
        transaction.type === "income"
          ? isConfirmed
            ? "Gelir alındı."
            : "Gelir beklemeye alındı."
          : isConfirmed
            ? "Gider ödendi."
            : "Gider beklemeye alındı.",
      );
    }
  }

  async function undoTransaction(transactionId: string) {
    if (!user) return;
    const target = transactions.find((item) => item.id === transactionId);
    if (!target) return;

    setDeletingTransactionId(transactionId);
    try {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", transactionId)
        .eq("user_id", user.id);
      if (error) {
        console.error("İşlem silme hatası:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        showToast(`İşlem silinemedi [${error.code}]: ${error.message}`, 8000);
        return;
      }

      if (target.source === "debtPayment" && target.debtId) {
        setDebts((current) =>
          current.map((debt) =>
            debt.id === target.debtId
              ? {
                  ...debt,
                  paid: false,
                  paidFrom: undefined,
                  paidAt: undefined,
                  paidTransactionId: undefined,
                }
              : debt,
          ),
        );
      }
      setTransactions((current) => current.filter((item) => item.id !== transactionId));
      setPendingDeleteId(null);
      showToast("İşlem silindi.");
    } catch (error) {
      console.error("İşlem silme hatası:", error);
      showToast(
        `İşlem silinemedi: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      );
    } finally {
      setDeletingTransactionId(null);
    }
  }

  function openEditTransaction(transaction: Transaction) {
    setPendingDeleteId(null);
    setEditingTransactionId(transaction.id);
    setEditType(transaction.type);
    setEditTransferSource(transaction.account);
    setEditTransferTarget(transaction.toAccount ?? "cash");
    setEditCategory(transaction.category);
    setEditAmount(String(transaction.amount));
    setEditNote(transaction.note);
    setEditDate(transaction.date);
  }

  function closeEditTransaction() {
    setEditingTransactionId(null);
  }

  async function saveEditedTransaction(event: React.FormEvent) {
    event.preventDefault();
    if (!editingTransactionId || !user) return;

    const amount = parseAmountInput(editAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Tutar 0'dan büyük olmalı.");
      return;
    }

    const updatedDate = editDate || todayInputValue();
    const updatedNote = editNote.trim();
    const targetId = editingTransactionId;
    const targetTransaction = transactions.find((item) => item.id === targetId);
    if (!targetTransaction) return;
    if (
      isPlanRestricted &&
      updatedDate.slice(0, 7) !== targetTransaction.date.slice(0, 7) &&
      transactions.filter((item) => item.date.slice(0, 7) === updatedDate.slice(0, 7)).length >= 3
    ) {
      openXLUpgrade();
      return;
    }
    if (
      editType === "transfer" &&
      editTransferSource === editTransferTarget
    ) {
      alert("Kaynak ve hedef hesap aynı olamaz.");
      return;
    }

    const updatedIsConfirmed =
      editType === "transfer"
        ? true
        : targetTransaction.type === editType
          ? targetTransaction.isConfirmed
          : editType === "expense";
    const updatedAccount =
      editType === "transfer" ? editTransferSource : targetTransaction.account;
    const updatedToAccount =
      editType === "transfer" ? editTransferTarget : undefined;

    setTransactions((current) =>
      current.map((item) => {
        if (item.id !== targetId) return item;
        return {
          ...item,
          date: updatedDate,
          type: editType,
          account: updatedAccount,
          toAccount: updatedToAccount,
          category: editType === "transfer" ? "Transfer" : editCategory,
          amount,
          note: updatedNote,
          isConfirmed: updatedIsConfirmed,
        };
      }),
    );

    closeEditTransaction();

    const { error } = await supabase
      .from("transactions")
      .update({
        date: updatedDate,
        type: editType,
        account: updatedAccount,
        ...(editType === "transfer" || targetTransaction.type === "transfer"
          ? { to_account: updatedToAccount ?? null }
          : {}),
        category: editType === "transfer" ? "Transfer" : editCategory,
        amount,
        note: updatedNote,
        is_confirmed: updatedIsConfirmed,
      })
      .eq("id", targetId)
      .eq("user_id", user.id);

    if (error) {
      console.error("İşlem güncelleme hatası:", error);
    }
  }

  const isFutureTransactionDate = txDate > todayInputValue();
  const quickCategoryOptions =
    txType === "income" ? quickIncomeCategories : quickExpenseCategories;
  const isLoading = !authReady || (!!user && (!loaded || loadedUserId !== user.id));
  const pendingDeleteTransaction = pendingDeleteId
    ? transactions.find((item) => item.id === pendingDeleteId)
    : undefined;
  const pendingDeleteGoal = pendingDeleteGoalId
    ? activeSavingsGoals.find((goal) => goal.id === pendingDeleteGoalId)
    : undefined;

  return (
    <>
      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
      <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <Image
          src="/bg-fjord.jpg"
          alt=""
          fill
          sizes="100vw"
          preload
          className="object-cover blur-md md:blur-xl"
        />
        <div className="absolute inset-0 bg-[#060d18]/35 md:bg-[#060d18]/55" />
      </div>
      {authReady && !user ? <AuthScreen /> : null}
      {authReady && user ? (
    <main className="page">
      <div className="shell pb-28 md:pb-0">
        {isXL &&
          profile?.planSource === "trial" &&
          trialDaysRemaining !== null &&
          trialDaysRemaining <= 5 &&
          !trialBannerDismissed && (
            <div className="trialReminderBanner" role="status">
              <span>XL denemenin bitmesine {trialDaysRemaining} gün kaldı.</span>
              <button
                type="button"
                onClick={() => setTrialBannerDismissed(true)}
                aria-label="Deneme hatırlatmasını kapat"
              >
                ×
              </button>
            </div>
          )}
        <header className="hero">
          <div className="brandWithLimit">
            <div className="brand">
              <div className="logoLine">
                <div className="logo overflow-hidden rounded-xl">
                  <Image
                    className="logoImage object-cover scale-[1.35]"
                    src="/fiyor-logo.jpg"
                    alt="Fiyor₺X logosu"
                    width={60}
                    height={60}
                    priority
                  />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">Fiyor₺X</h1>
              </div>
              <p className="subtitle">Kişisel para akışı, ödemeler ve birikim takibi.</p>
            </div>

            {monthlyLimit !== null ? (
              <MonthlyLimitBar
                spent={monthlyExpenseTotal}
                limit={monthlyLimit}
                privacyMode={privacyMode}
                onOpen={openMonthlyLimitModal}
              />
            ) : (
              <button
                className="monthlyLimitSetup glass"
                type="button"
                onClick={openMonthlyLimitModal}
              >
                <AppIcon name="snowflake" size={16} />
                <span>Limit Ekle</span>
              </button>
            )}
          </div>

          <div className="heroStats">
            <div className="miniStat flex flex-col justify-center gap-1">
              <span>Genel Harcanabilir</span>
              <strong>{formatMoney(balances.totalSpendable, privacyMode)}</strong>
            </div>
            <div className="miniStat flex flex-col justify-center gap-1">
              <span>Toplam Varlık</span>
              <strong>{formatMoney(balances.totalAssets, privacyMode)}</strong>
            </div>
          </div>
          <div className="heroActions gap-2.5">
            <button
              className="iconButton glass w-11 h-11 relative"
              type="button"
              onClick={() => {
                setNotificationSection("items");
                setNotificationCenterOpen(true);
              }}
              aria-label={
                activeReminders.length > 0
                  ? `Bildirim merkezini aç, ${activeReminders.length} bekleyen hatırlatma`
                  : "Bildirim merkezini aç"
              }
              title="Bildirim Merkezi"
            >
              <AppIcon name="bell" size={20} className="w-5 h-5" />
              {activeReminders.length > 0 && (
                <span className="notificationBadge" aria-hidden="true">
                  {activeReminders.length > 9 ? "9+" : activeReminders.length}
                </span>
              )}
            </button>
            <button
              className="iconButton glass w-11 h-11"
              type="button"
              onClick={togglePrivacyMode}
              aria-label={privacyMode ? "Tutarları göster" : "Tutarları gizle"}
              aria-pressed={privacyMode}
              title={privacyMode ? "Tutarları göster" : "Tutarları gizle"}
            >
              <AppIcon
                name={privacyMode ? "eyeOff" : "eye"}
                size={20}
                className="w-5 h-5"
              />
            </button>
            <button
              className="profileAvatar w-11 h-11"
              type="button"
              onClick={() => setAccountMenuOpen(true)}
              aria-label="Hesap menüsünü aç"
              title="Hesap"
            >
              {profile?.avatarUrl ? (
                <Image
                  src={profile.avatarUrl}
                  alt=""
                  width={42}
                  height={42}
                  unoptimized
                />
              ) : (
                <span>{user?.email?.trim().charAt(0).toUpperCase() || "?"}</span>
              )}
            </button>
          </div>
        </header>

        <nav className={`tabs ${isScrolled ? "scrolled" : ""} md:justify-center md:gap-4`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              <AppIcon name={tabIcons[tab.id]} size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <section className="sectionStack">
            <div className="grid cards balanceCards" key={loaded ? "loaded" : "loading"}>
              <EditableMoneyCard
                label="Nakit"
                icon="cash"
                value={baseBalances.cash}
                privacyMode={privacyMode}
                onChange={(value) => updateBaseBalance("cash", value)}
              />
              <EditableMoneyCard
                label="Banka"
                icon="bank"
                value={baseBalances.bank}
                privacyMode={privacyMode}
                onChange={(value) => updateBaseBalance("bank", value)}
              />
              <EditableMoneyCard
                label="Kredi Kartı Borcu"
                icon="creditCard"
                value={baseBalances.creditDebt}
                privacyMode={privacyMode}
                onChange={(value) => updateBaseBalance("creditDebt", value)}
              />
              <EditableMoneyCard
                label="Yan Hak"
                icon="benefit"
                value={baseBalances.benefit}
                privacyMode={privacyMode}
                onChange={(value) => updateBaseBalance("benefit", value)}
              />
              <EditableMoneyCard
                label="Birikim"
                icon="savings"
                value={baseBalances.savings}
                privacyMode={privacyMode}
                onChange={(value) => updateBaseBalance("savings", value)}
              />
            </div>

            <div className="grid overviewTotals">
              <ReadonlyMoneyCard label="Ana Para" value={formatMoney(balances.mainMoney, privacyMode)} />
              <ReadonlyMoneyCard
                label="Genel Harcanabilir"
                value={formatMoney(balances.totalSpendable, privacyMode)}
              />
              <ReadonlyMoneyCard
                label="Toplam Varlık"
                value={formatMoney(balances.totalAssets, privacyMode)}
              />
            </div>

            <section className="panel savingsGoalsPanel">
              <div className="savingsGoalsHeader">
                <div>
                  <h2>Birikim Hedefleri</h2>
                  <p>Hedeflerini takip et, birikimlerini adım adım büyüt.</p>
                </div>
                <button
                  className="btn savingsGoalAddButton"
                  type="button"
                  onClick={() => setSavingsGoalModalOpen(true)}
                >
                  + Hedef Ekle
                </button>
              </div>

              {activeSavingsGoals.length === 0 ? (
                <Empty text="Henüz birikim hedefi eklenmedi." />
              ) : (
                <div className="savingsGoalList">
                  {activeSavingsGoals.map((goal) => {
                    const progress =
                      goal.targetAmount > 0
                        ? Math.min(100, Math.max(0, (goal.currentAmount / goal.targetAmount) * 100))
                        : 0;
                    return (
                      <article className="savingsGoalItem" key={goal.id}>
                        <div className="savingsGoalTop">
                          <div>
                            <h3>{goal.title}</h3>
                            <span className="savingsGoalAmounts">
                              {formatMoney(goal.currentAmount, privacyMode)} /{" "}
                              {formatMoney(goal.targetAmount, privacyMode)}
                            </span>
                          </div>
                          <strong className="savingsGoalProgressLabel">
                            {privacyMode ? "••%" : formatPercent(progress)}
                          </strong>
                        </div>
                        <div
                          className="savingsGoalProgressTrack"
                          role="progressbar"
                          aria-label={`${goal.title} hedef ilerlemesi`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(progress)}
                        >
                          <div
                            className="savingsGoalProgressFill"
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        {goalContributionId === goal.id ? (
                          <form
                            className="savingsGoalContribution"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void addSavingsGoalContribution(goal.id);
                            }}
                          >
                            <input
                              className="h-10"
                              type="text"
                              inputMode="decimal"
                              aria-label={`${goal.title} hedefine eklenecek tutar`}
                              value={goalContributionDraft}
                              onChange={(event) => setGoalContributionDraft(event.target.value)}
                              placeholder="Eklenecek tutar"
                              autoFocus
                            />
                            <button className="btn small success" type="submit" disabled={savingGoal}>
                              Ekle
                            </button>
                            <button
                              className="btn small secondary"
                              type="button"
                              onClick={() => {
                                setGoalContributionId(null);
                                setGoalContributionDraft("");
                              }}
                              disabled={savingGoal}
                            >
                              İptal
                            </button>
                          </form>
                        ) : (
                          <div className="savingsGoalActions">
                            <button
                              className="btn small success"
                              type="button"
                              onClick={() => {
                                setGoalContributionId(goal.id);
                                setGoalContributionDraft("");
                              }}
                            >
                              + Tutar Ekle
                            </button>
                            <button
                              className="btn small danger"
                              type="button"
                              onClick={() => setPendingDeleteGoalId(goal.id)}
                            >
                              Sil
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </section>
        )}

        {activeTab === "transaction" && (
          <section className="sectionStack transactionTab">
            <section className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>İşlem Ekle</h2>
                  <p>Gelir, gider veya hesaplar arası transfer gir.</p>
                </div>
              </div>

              <form onSubmit={addTransaction} className="sectionStack">
                <div className="formGrid transactionFormGrid">
                  <div className="field transactionTypeField">
                    <label>İşlem Tipi</label>
                    <select
                      className="h-11"
                      value={txType}
                      onChange={(event) =>
                        handleTransactionTypeChange(event.target.value as TransactionType)
                      }
                    >
                      <option value="expense">Gider</option>
                      <option value="income">Gelir / Ödeme</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </div>

                  <div className="field transactionAccountsField">
                    <label>{txType === "transfer" ? "Kaynak / Hedef Hesap" : "Hesap"}</label>
                    <div className={`transactionAccountPair ${txType === "transfer" ? "hasTarget" : ""}`}>
                      <select
                        className="h-11"
                        aria-label={txType === "transfer" ? "Kaynak Hesap" : "Hesap"}
                        value={txAccount}
                        onChange={(event) => {
                          const source = event.target.value as AccountKey;
                          setTxAccount(source);
                          if (source !== "creditCard") setInstallmentCount("1");
                          if (txType === "transfer" && source === txTransferTarget) {
                            setTxTransferTarget(source === "cash" ? "bank" : "cash");
                          }
                        }}
                      >
                        {(txType === "transfer" ? transferSourceOptions : accountOptions).map(
                          (account) => (
                            <option key={account} value={account}>
                              {accountLabels[account]}
                            </option>
                          ),
                        )}
                      </select>
                      {txType === "transfer" && (
                        <select
                          className="h-11"
                          aria-label="Hedef Hesap"
                          value={txTransferTarget}
                          onChange={(event) =>
                            setTxTransferTarget(event.target.value as AccountKey)
                          }
                        >
                          {transferTargetOptions
                            .filter((account) => account !== txAccount)
                            .map((account) => (
                              <option key={account} value={account}>
                                {account === "creditCard"
                                  ? "Kredi Kartı Borcu"
                                  : accountLabels[account]}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="field transactionAmountField">
                    <label>Tutar</label>
                    <input
                      className="h-11"
                      type="text"
                      inputMode="decimal"
                      value={privacyMode ? MASKED_MONEY : txAmount}
                      readOnly={privacyMode}
                      onChange={(event) => setTxAmount(event.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="field transactionDateField">
                    <label>Tarih</label>
                    <input
                      className="h-11"
                      type="date"
                      value={txDate}
                      onChange={(event) => {
                        const nextDate = event.target.value;
                        setTxDate(nextDate);
                        if (nextDate > todayInputValue()) setTxIsConfirmed(false);
                      }}
                    />
                  </div>

                  {txType !== "transfer" && (
                    <div className="field full transactionCategoryField">
                      <label>Kategori</label>
                      <input
                        className="h-11"
                        type="text"
                        value={txCategory}
                        onChange={(event) => setTxCategory(event.target.value)}
                        placeholder="Kategori yaz..."
                      />
                      <div className="quickCategoryChips" role="group" aria-label="Hızlı kategori seçimi">
                        {quickCategoryOptions.map((category) => (
                          <button
                            key={category}
                            className={`quickCategoryChip ${txCategory === category ? "active" : ""}`}
                            type="button"
                            aria-pressed={txCategory === category}
                            onClick={() => setTxCategory(category)}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                      {txType === "expense" && txAccount === "creditCard" && (
                        <div className="installmentSelector">
                          <span className="installmentLabel">Taksit</span>
                          <div className="installmentOptions" role="group" aria-label="Taksit sayısı">
                            {[
                              ["1", "Peşin"],
                              ["2", "2"],
                              ["3", "3"],
                              ["6", "6"],
                              ["9", "9"],
                              ["12", "12"],
                            ].map(([count, label]) => {
                              const locked = count !== "1" && isPlanRestricted;
                              const selected =
                                count === "1"
                                  ? Number(installmentCount) === 1 || isPlanRestricted
                                  : !isPlanRestricted && installmentCount === count;
                              return (
                                <button
                                  key={count}
                                  className={`installmentOption ${selected ? "active" : ""} ${locked ? "lockedPlanOption" : ""}`}
                                  type="button"
                                  aria-pressed={selected}
                                  aria-disabled={locked}
                                  onClick={() => {
                                    if (locked) {
                                      openXLUpgrade();
                                      return;
                                    }
                                    setInstallmentCount(count);
                                  }}
                                >
                                  {locked && <PlanLockIcon />}
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          {!isPlanRestricted && Number(installmentCount) > 1 && parseAmountInput(txAmount) > 0 && (
                            <span className="installmentPreview">
                              {installmentCount} ×{" "}
                              {formatMoney(parseAmountInput(txAmount) / Number(installmentCount), privacyMode)}{" "}
                              / ay
                            </span>
                          )}
                        </div>
                      )}
                      {(txType === "income" || txType === "expense") && (
                        <div className="transactionConfirmationField">
                          <label className="incomeConfirmationField">
                            <input
                              className="incomeConfirmationCheckbox"
                              type="checkbox"
                              checked={txIsConfirmed && !isFutureTransactionDate}
                              disabled={isFutureTransactionDate}
                              onChange={(event) => setTxIsConfirmed(event.target.checked)}
                            />
                            <span>
                              {txType === "income"
                                ? "Bu parayı aldım (bakiyeye hemen ekle)"
                                : "Bu harcamayı ödedim (bakiyeden hemen düş)"}
                            </span>
                          </label>
                          {isFutureTransactionDate && (
                            <span className="fieldHint">
                              İleri tarihli işlemler beklemede eklenir.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="field full transactionNoteField">
                    <label>Not</label>
                    <textarea
                      rows={2}
                      value={txNote}
                      onChange={(event) => setTxNote(event.target.value)}
                      placeholder="İsteğe bağlı not..."
                    />
                  </div>
                </div>

                <div className="buttonRow">
                  <button className="btn" type="submit" disabled={privacyMode}>
                    {txType === "transfer" ? "Transferi Ekle" : "İşlemi Ekle"}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setTxAmount("");
                      setTxNote("");
                      setTxDate(todayInputValue());
                      setTxIsConfirmed(txType === "expense");
                    }}
                  >
                    Temizle
                  </button>
                </div>
              </form>
            </section>

            <section className="fixedIncomePanel glass">
              <div className="sectionHeader">
                <div>
                  <h2>Sabit Gelir / Giderler</h2>
                  <p>Günü geldiğinde Geçmiş&apos;e bekleyen işlem olarak eklenir.</p>
                </div>
              </div>

              <div className="fixedFlowTypeSwitch" role="group" aria-label="Sabit işlem türü">
                <button
                  className={`quickCategoryChip ${fixedIncomeType === "income" ? "active" : ""}`}
                  type="button"
                  aria-pressed={fixedIncomeType === "income"}
                  onClick={() => handleFixedIncomeTypeChange("income")}
                >
                  Gelir
                </button>
                <button
                  className={`quickCategoryChip ${fixedIncomeType === "expense" ? "active" : ""}`}
                  type="button"
                  aria-pressed={fixedIncomeType === "expense"}
                  onClick={() => handleFixedIncomeTypeChange("expense")}
                >
                  Gider
                </button>
              </div>

              <form className="fixedIncomeForm" onSubmit={addFixedIncome}>
                <div className="field">
                  <label htmlFor="fixed-income-title">Başlık</label>
                  <input
                    id="fixed-income-title"
                    type="text"
                    value={fixedIncomeTitle}
                    onChange={(event) => setFixedIncomeTitle(event.target.value)}
                    placeholder={fixedIncomeType === "income" ? "Maaş" : "Kira / Elektrik"}
                  />
                </div>
                <div className="field">
                  <label htmlFor="fixed-income-amount">Tutar</label>
                  <input
                    id="fixed-income-amount"
                    type="text"
                    inputMode="decimal"
                    value={privacyMode ? MASKED_MONEY : fixedIncomeAmount}
                    readOnly={privacyMode}
                    onChange={(event) => setFixedIncomeAmount(event.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="field">
                  <label htmlFor="fixed-income-account">
                    {fixedIncomeType === "income" ? "Hedef Hesap" : "Ödeme Hesabı"}
                  </label>
                  <select
                    id="fixed-income-account"
                    value={fixedIncomeAccount}
                    onChange={(event) => setFixedIncomeAccount(event.target.value as AccountKey)}
                  >
                    {(fixedIncomeType === "income"
                      ? (["bank", "cash", "benefit", "savings"] as const)
                      : (["bank", "cash", "creditCard", "benefit"] as const)
                    ).map((account) => (
                      <option key={account} value={account}>
                        {accountLabels[account]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fixed-income-day">Ayın Günü</label>
                  <input
                    id="fixed-income-day"
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    value={fixedIncomeDay}
                    onChange={(event) => setFixedIncomeDay(event.target.value)}
                  />
                </div>
                <button className="btn fixedIncomeAddButton" type="submit" disabled={privacyMode}>
                  {fixedIncomeType === "income" ? "Sabit Gelir Ekle" : "Sabit Gider Ekle"}
                </button>
              </form>

              {fixedIncomeError && (
                <p className="fixedIncomeError" role="alert">
                  {fixedIncomeError}
                </p>
              )}
              {fixedIncomes.length > 0 ? (
                <div className="fixedIncomeList">
                  {fixedIncomes.map((income) => (
                    <div className="fixedIncomeItem" key={income.id}>
                      <div>
                        <strong>{income.title}</strong>
                        <span>
                          <span className={`pill ${income.type}`}>
                            {income.type === "income" ? "Gelir" : "Gider"}
                          </span>
                          {" "}{accountLabels[income.account]} · Ayın {income.dayOfMonth}. günü
                        </span>
                      </div>
                      <strong className="fixedIncomeAmount">
                        {formatMoney(income.amount, privacyMode)}
                      </strong>
                      <button
                        className="btn danger small"
                        type="button"
                        onClick={() => deleteFixedIncome(income.id)}
                      >
                        Sil
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="Henüz sabit gelir veya gider tanımlanmadı." />
              )}
            </section>
          </section>
        )}

        {activeTab === "history" && (
          <section className="panel">
            <div className="sectionHeader historyToolbar">
              <div>
                <h2>Geçmiş</h2>
                <p>Eklenen işlemler burada listelenir.</p>
              </div>
              <MonthSelector
                value={selectedMonth}
                currentMonth={currentMonth}
                onChange={setSelectedMonth}
              />
            </div>

            <div className="historyFilters" role="group" aria-label="İşlem filtreleri">
              {(
                [
                  ["all", "Tümü"],
                  ["pending", "Bekleyenler"],
                  ["income", "Gelir"],
                  ["expense", "Gider"],
                  ["transfer", "Transfer"],
                ] as const
              ).map(([filter, label]) => (
                <button
                  key={filter}
                  className={`historyFilter ${historyFilter === filter ? "active" : ""}`}
                  type="button"
                  aria-pressed={historyFilter === filter}
                  onClick={() => setHistoryFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>

            {sortedTransactions.length === 0 ? (
              <Empty
                text={
                  transactions.length === 0
                    ? "Henüz işlem yok."
                    : "Bu filtrede işlem bulunamadı."
                }
              />
            ) : (
              <div className="list">
                {sortedTransactions.map((item) => (
                  <div
                    className={`historyEntry ${item.isSystemXL && !isXL ? "systemPlanEntry" : ""}`}
                    key={item.id}
                    role={item.isSystemXL && !isXL ? "button" : undefined}
                    tabIndex={item.isSystemXL && !isXL ? 0 : undefined}
                    aria-label={
                      item.isSystemXL && !isXL
                        ? "XL aboneliği hakkında bilgi al"
                        : undefined
                    }
                    onClick={item.isSystemXL && !isXL ? openXLUpgrade : undefined}
                    onKeyDown={
                      item.isSystemXL && !isXL
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openXLUpgrade();
                            }
                          }
                        : undefined
                    }
                  >
                    <div className="listItem">
                      <div>
                        <div className="listTitle">
                          <span
                            className={`pill ${
                              item.type !== "transfer" && !item.isConfirmed
                                ? "pending"
                                : item.type
                            }`}
                          >
                            {item.type === "transfer"
                              ? "Transfer"
                              : !item.isConfirmed
                                ? "Bekliyor"
                                : item.type === "income"
                                  ? "Gelir"
                                  : "Gider"}
                          </span>
                          {item.type !== "transfer" && (
                            <span>{transactionDisplayCategory(item)}</span>
                          )}
                          {item.isSystemXL && <span className="planTinyBadge">XL</span>}
                          {item.source === "debtPayment" && <span className="pill">Ödeme</span>}
                        </div>

                        <div className="meta">
                          <span>{formatDate(item.date)}</span>
                          <span>
                            {item.type === "transfer"
                              ? `${accountLabels[item.account]} → ${
                                  item.toAccount === "creditCard"
                                    ? "Kredi Kartı Borcu"
                                    : accountLabels[item.toAccount ?? "cash"]
                                }`
                              : accountLabels[item.account]}
                          </span>
                        </div>

                        {item.note && <p className="note">{item.note}</p>}
                      </div>

                      <div>
                        <div
                          className={`amount ${item.type} ${
                            item.type !== "transfer" && !item.isConfirmed ? "pending" : ""
                          }`}
                        >
                          {item.type === "income" ? "+" : item.type === "expense" ? "−" : "↔ "}
                          {formatMoney(item.amount, privacyMode)}
                        </div>

                        {!(item.isSystemXL && !isXL) && (
                          <div className="buttonRow transactionActions">
                            <button
                              className="btn info small"
                              type="button"
                              onClick={() => openEditTransaction(item)}
                            >
                              Düzenle
                            </button>
                            <button
                              className="btn danger small"
                              type="button"
                              onClick={() => setPendingDeleteId(item.id)}
                            >
                              Geri Al
                            </button>
                            {item.type !== "transfer" && (
                              <button
                                className={`btn small ${item.isConfirmed ? "secondary" : "success"}`}
                                type="button"
                                onClick={() =>
                                  updateTransactionConfirmation(item.id, !item.isConfirmed)
                                }
                              >
                                {item.type === "income"
                                  ? item.isConfirmed
                                    ? "Almadım"
                                    : "Aldım"
                                  : item.isConfirmed
                                    ? "Ödemedim"
                                    : "Ödedim"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {editingTransactionId === item.id && (
                      <form
                        onSubmit={saveEditedTransaction}
                        className="sectionStack editTransactionPanel"
                        aria-label="İşlemi düzenle"
                      >
                        <div className="editPanelHeader">
                          <h3>İşlemi Düzenle</h3>
                          <p>Seçili işlem bilgilerini güncelle.</p>
                        </div>

                        <div className="formGrid editFormGrid">
                          <div className="field">
                            <label>İşlem Tipi</label>
                            <select
                              value={editType}
                              onChange={(event) =>
                                handleEditTransactionTypeChange(event.target.value as TransactionType)
                              }
                            >
                              <option value="expense">Gider</option>
                              <option value="income">Gelir / Ödeme</option>
                              <option value="transfer">Transfer</option>
                            </select>
                          </div>

                            {editType === "transfer" ? (
                              <>
                                <div className="field">
                                  <label>Kaynak Hesap</label>
                                  <select
                                    value={editTransferSource}
                                    onChange={(event) => {
                                      const source = event.target.value as AccountKey;
                                      setEditTransferSource(source);
                                      if (source === editTransferTarget) {
                                        setEditTransferTarget(source === "cash" ? "bank" : "cash");
                                      }
                                    }}
                                  >
                                    {transferSourceOptions.map((account) => (
                                      <option key={account} value={account}>
                                        {accountLabels[account]}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="field">
                                  <label>Hedef Hesap</label>
                                  <select
                                    value={editTransferTarget}
                                    onChange={(event) =>
                                      setEditTransferTarget(event.target.value as AccountKey)
                                    }
                                  >
                                    {transferTargetOptions
                                      .filter((account) => account !== editTransferSource)
                                      .map((account) => (
                                        <option key={account} value={account}>
                                          {account === "creditCard"
                                            ? "Kredi Kartı Borcu"
                                            : accountLabels[account]}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              </>
                            ) : (
                              <div className="field">
                                <label>Kategori</label>
                                <select
                                  value={editCategory}
                                  onChange={(event) => setEditCategory(event.target.value)}
                                >
                                  {[
                                    ...new Set([
                                      ...(editType === "income" ? incomeCategories : expenseCategories),
                                      editCategory,
                                    ]),
                                  ].map((category) => (
                                    <option key={category} value={category}>
                                      {category}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                          <div className="field">
                            <label>Tutar</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={privacyMode ? MASKED_MONEY : editAmount}
                              readOnly={privacyMode}
                              onChange={(event) => setEditAmount(event.target.value)}
                              placeholder="0"
                            />
                          </div>

                          <div className="field">
                            <label>Tarih</label>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(event) => setEditDate(event.target.value)}
                            />
                          </div>

                          <div className="field full">
                            <label>Açıklama</label>
                            <textarea
                              value={editNote}
                              onChange={(event) => setEditNote(event.target.value)}
                              placeholder="İsteğe bağlı not..."
                            />
                          </div>
                        </div>

                        <div className="buttonRow editActions">
                          <button className="btn success" type="submit" disabled={privacyMode}>
                            Kaydet
                          </button>
                          <button className="btn secondary" type="button" onClick={closeEditTransaction}>
                            İptal
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "analysis" && (
          <section className="sectionStack analysisSection">
            <div className="sectionHeader analysisToolbar">
              <div>
                <h2>Analiz</h2>
                <p>Seçili dönemin gelir, gider ve hesap hareketleri.</p>
                {isForecastView && (
                  <span className="forecastBadge">Planlanan / Tahmini Görünüm</span>
                )}
              </div>
              <MonthSelector
                value={isPlanRestricted ? currentMonth : selectedMonth}
                currentMonth={currentMonth}
                onChange={(month) => {
                  if (isPlanRestricted) {
                    openXLUpgrade();
                    return;
                  }
                  setSelectedMonth(month);
                  setAnalysisDateFilter(month ? "month" : "all");
                }}
                locked={isPlanRestricted}
                onLocked={openXLUpgrade}
              />
            </div>

            <div className="analysisDateFilterPanel glass">
              <div className="analysisDateFilterGroups">
                <div className="analysisDateFilterGroup" role="group" aria-label="Geçmiş dönem">
                  <span>Geçmiş</span>
                  {([
                    ["past-2", "Son 2 Ay"],
                    ["past-3", "Son 3 Ay"],
                    ["past-6", "Son 6 Ay"],
                  ] as const).map(([filter, label]) => {
                    const locked = isPlanRestricted;
                    return (
                      <button
                        key={filter}
                        className={`analysisDatePill ${!isPlanRestricted && analysisDateFilter === filter ? "active" : ""} ${locked ? "lockedPlanOption" : ""}`}
                        type="button"
                        aria-pressed={!isPlanRestricted && analysisDateFilter === filter}
                        aria-disabled={locked}
                        onClick={() => {
                          if (locked) {
                            openXLUpgrade();
                            return;
                          }
                          setAnalysisDateFilter(filter);
                        }}
                      >
                        {locked && <PlanLockIcon />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="analysisDateFilterGroup" role="group" aria-label="Gelecek dönem">
                  <span>Gelecek</span>
                  {([
                    ["future-2", "Gelecek 2 Ay"],
                    ["future-3", "Gelecek 3 Ay"],
                    ["future-6", "Gelecek 6 Ay"],
                  ] as const).map(([filter, label]) => {
                    const locked = isPlanRestricted;
                    return (
                      <button
                        key={filter}
                        className={`analysisDatePill ${!isPlanRestricted && analysisDateFilter === filter ? "active" : ""} ${locked ? "lockedPlanOption" : ""}`}
                        type="button"
                        aria-pressed={!isPlanRestricted && analysisDateFilter === filter}
                        aria-disabled={locked}
                        onClick={() => {
                          if (locked) {
                            openXLUpgrade();
                            return;
                          }
                          setAnalysisDateFilter(filter);
                        }}
                      >
                        {locked && <PlanLockIcon />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="analysisDateFilterGroup" role="group" aria-label="Özel tarih aralığı">
                  <button
                    className={`analysisDatePill ${!isPlanRestricted && analysisDateFilter === "custom" ? "active" : ""} ${isPlanRestricted ? "lockedPlanOption" : ""}`}
                    type="button"
                    aria-pressed={!isPlanRestricted && analysisDateFilter === "custom"}
                    aria-disabled={isPlanRestricted}
                    onClick={() => {
                      if (isPlanRestricted) {
                        openXLUpgrade();
                        return;
                      }
                      setAnalysisDateFilter("custom");
                    }}
                  >
                    {isPlanRestricted && <PlanLockIcon />}
                    Özel Aralık
                  </button>
                </div>
              </div>
              {effectiveAnalysisDateFilter === "custom" && (
                <>
                  <div className="customAnalysisRange">
                    <label>
                      <span>Başlangıç</span>
                      <input
                        type="date"
                        value={customRangeStart}
                        onChange={(event) => setCustomRangeStart(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Bitiş</span>
                      <input
                        type="date"
                        value={customRangeEnd}
                        onChange={(event) => setCustomRangeEnd(event.target.value)}
                      />
                    </label>
                  </div>
                  {!isCustomAnalysisRangeValid && (
                    <span className="customAnalysisRangeError" role="status">
                      Başlangıç ve bitiş tarihlerini doğru sırayla seç.
                    </span>
                  )}
                </>
              )}
            </div>

            <section className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>GİRİŞ</h2>
                  <p>Genel sekmesinde kaydedilen ilk gün bakiyeleri.</p>
                </div>
              </div>

              <div className="grid cards analysisSummaryGrid openingSummaryGrid">
                <ReadonlyMoneyCard label="Nakit" value={formatMoney(baseBalances.cash, privacyMode)} />
                <ReadonlyMoneyCard label="Banka" value={formatMoney(baseBalances.bank, privacyMode)} />
                <ReadonlyMoneyCard
                  label="Kredi Kartı Borcu"
                  value={formatMoney(baseBalances.creditDebt, privacyMode)}
                />
                <ReadonlyMoneyCard label="Yan Hak" value={formatMoney(baseBalances.benefit, privacyMode)} />
                <ReadonlyMoneyCard label="Birikim" value={formatMoney(baseBalances.savings, privacyMode)} />
                <ReadonlyMoneyCard label="Net Giriş" value={formatMoney(openingNetEntry, privacyMode)} />
              </div>
            </section>

            <div className="grid cards analysisSummaryGrid transactionSummaryGrid">
              <ReadonlyMoneyCard
                label="Toplam Gelir"
                value={formatMoney(transactionSummary.totalIncome, privacyMode)}
                icon="income"
                iconTone="income"
                trend={analysisMetricTrends.income}
              />
              <ReadonlyMoneyCard
                label="Toplam Gider"
                value={formatMoney(totalExpenseIncludingOpeningDebt, privacyMode)}
                icon="expense"
                iconTone="expense"
                trend={analysisMetricTrends.expense}
              />
              <ReadonlyMoneyCard
                label="Net Akış"
                value={formatMoney(transactionSummary.netFlow, privacyMode)}
                icon="net"
                iconTone="net"
                trend={analysisMetricTrends.net}
              />
              <ReadonlyMoneyCard
                label="İşlem Sayısı"
                value={String(transactionSummary.transactionCount)}
                icon="count"
                iconTone="count"
                trend={analysisMetricTrends.count}
              />
            </div>

            <div className="glass smartSummaryCard">
              <div className="smartSummaryHeader">
                <span>Akıllı Özet</span>
              </div>

              <ul className="smartSummaryList">
                {smartSummaryItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="glass insightsCard">
              <div className="smartSummaryHeader">
                <span>İçgörüler</span>
              </div>

              <div className="insightsGrid">
                {insightItems.map((item) => (
                  <div className="insightItem" key={item.label}>
                    <div className="insightHeading">
                      <span className={`insightIcon ${item.tone}`} aria-hidden="true" />
                      <span className="insightLabel">{item.label}</span>
                    </div>
                    <strong className="insightValue">{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass trendCard">
              <div className="smartSummaryHeader">
                <span>Trend Analizi</span>
              </div>

              {trendAnalysis.hasComparison ? (
                <div className="trendGrid">
                  {trendAnalysis.items.map((item) => (
                    <div className={`trendItem ${item.tone}`} key={item.label}>
                      <span className="trendLabel">{item.label}</span>
                      <strong className="trendValue">{item.value}</strong>
                      <span className="trendDetail">{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="trendEmpty">{trendAnalysis.message}</div>
              )}
            </div>

            <div className="panel glass analysisPanel">
              <div className="analysisPicker">
                <button
                  className={`analysisChoice glass ${analysisMode === "category" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisMode("category")}
                >
                  <h3>Kategori</h3>
                  <p>Harcamaları kategoriye göre karşılaştır.</p>
                  <div className="previewBars">
                    <div className="previewBar">
                      <div className="previewFill" style={{ width: "88%" }} />
                    </div>
                    <div className="previewBar">
                      <div className="previewFill" style={{ width: "62%" }} />
                    </div>
                    <div className="previewBar">
                      <div className="previewFill" style={{ width: "42%" }} />
                    </div>
                  </div>
                </button>

                <button
                  className={`analysisChoice glass ${analysisMode === "flow" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisMode("flow")}
                >
                  <h3>Akış</h3>
                  <p>Aylık gelir, gider ve net farkı gör.</p>
                  <div className="previewFlow">
                    <div className="previewColumn" style={{ height: "42px" }} />
                    <div className="previewColumn" style={{ height: "78px" }} />
                    <div className="previewColumn" style={{ height: "56px" }} />
                    <div className="previewColumn" style={{ height: "92px" }} />
                  </div>
                </button>

                <button
                  className={`analysisChoice glass ${analysisMode === "pie" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisMode("pie")}
                >
                  <h3>Pasta</h3>
                  <p>Gider dağılımını yüzdelik olarak incele.</p>
                  <div className="previewPie" />
                </button>
              </div>

              <div className="analysisCanvas">
                <div className="analysisInner">
                  {privacyMode ? (
                    <Empty text="Gizlilik modu açıkken grafik verileri gizlenir." />
                  ) : analysisTransactions.length === 0 ? (
                    <Empty text="Seçilen dönem için işlem bulunamadı." />
                  ) : (
                    <>
                      {analysisMode === "category" && (
                        <CategoryBars data={categoryData} privacyMode={privacyMode} />
                      )}
                      {analysisMode === "flow" && (
                        <FlowChart data={monthlyFlowData} privacyMode={privacyMode} />
                      )}
                      {analysisMode === "pie" && (
                        <PieChart
                          incomeData={incomeData}
                          expenseData={categoryData}
                          netFlow={transactionSummary.netFlow}
                          privacyMode={privacyMode}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
      ) : null}
      {user && notificationCenterOpen && (
        <div
          className="accountOverlay notificationCenterOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNotificationCenterOpen(false);
          }}
        >
          <section
            className="notificationCenterModal accountMenu glass max-h-[85vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-center-title"
          >
            <header className="notificationCenterHeader">
              <div>
                <h2 id="notification-center-title">Bildirim Merkezi</h2>
                <p>Önemli ödeme ve bütçe hatırlatmaların.</p>
              </div>
              <button
                className="iconButton glass"
                type="button"
                onClick={() => setNotificationCenterOpen(false)}
                aria-label="Bildirim merkezini kapat"
              >
                ×
              </button>
            </header>

            <div className="notificationCenterTabs" role="tablist" aria-label="Bildirim merkezi">
              <button
                className={notificationSection === "items" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={notificationSection === "items"}
                onClick={() => setNotificationSection("items")}
              >
                Bildirimler
                {activeReminders.length > 0 && (
                  <span className="notificationTabCount">{activeReminders.length}</span>
                )}
              </button>
              <button
                className={notificationSection === "settings" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={notificationSection === "settings"}
                onClick={() => setNotificationSection("settings")}
              >
                Hatırlatma Ayarları
              </button>
            </div>

            {notificationSection === "items" ? (
              activeReminders.length === 0 ? (
                <div className="notificationEmptyState">
                  <AppIcon name="bell" size={22} />
                  <p>Şu an bekleyen bildirimin yok.</p>
                </div>
              ) : (
                <div className="notificationList">
                  {activeReminders.map((reminder) => (
                    <article
                      className={`notificationItem notificationItem-${reminder.kind}`}
                      key={reminder.id}
                    >
                      <div className="notificationItemContent">
                        <div className="notificationItemHeading">
                          <strong>{reminder.title}</strong>
                          <span>{reminder.dateLabel}</span>
                        </div>
                        <p>
                          {reminder.kind === "fixed"
                            ? `${reminder.body} · ${formatMoney(reminder.amount ?? 0, privacyMode)}`
                            : reminder.body}
                        </p>
                      </div>
                      <button
                        className="notificationReadButton"
                        type="button"
                        onClick={() => markReminderRead(reminder)}
                      >
                        Okundu
                      </button>
                    </article>
                  ))}
                </div>
              )
            ) : (
              <form className="notificationSettingsForm" onSubmit={saveReminderSettings}>
                <p className="notificationSettingsIntro">
                  Kredi kartı günlerini gir; hatırlatmalar günü geldiğinde ve üç gün önceden
                  gösterilsin.
                </p>
                <label className="notificationDayField" htmlFor="cc-statement-day">
                  <span>Kredi Kartı Hesap Kesim Günü</span>
                  <input
                    id="cc-statement-day"
                    type="number"
                    min="1"
                    max="31"
                    inputMode="numeric"
                    placeholder="Boş bırak"
                    value={reminderSettingsDraft.statementDay}
                    onChange={(event) => {
                      setReminderSettingsDraft((current) => ({
                        ...current,
                        statementDay: event.target.value,
                      }));
                      setReminderSettingsError("");
                    }}
                  />
                </label>
                <label className="notificationDayField" htmlFor="cc-due-day">
                  <span>Kredi Kartı Son Ödeme Günü</span>
                  <input
                    id="cc-due-day"
                    type="number"
                    min="1"
                    max="31"
                    inputMode="numeric"
                    placeholder="Boş bırak"
                    value={reminderSettingsDraft.dueDay}
                    onChange={(event) => {
                      setReminderSettingsDraft((current) => ({
                        ...current,
                        dueDay: event.target.value,
                      }));
                      setReminderSettingsError("");
                    }}
                  />
                </label>
                <label className="notificationToggle">
                  <span>
                    <strong>Bildirimleri Aç</strong>
                    <small>Uygulama içi ve cihaz hatırlatmaları</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={reminderSettingsDraft.enabled}
                    onChange={(event) =>
                      setReminderSettingsDraft((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  <span className="notificationToggleTrack" aria-hidden="true" />
                </label>
                {reminderSettingsError && (
                  <p className="notificationSettingsError" role="alert">
                    {reminderSettingsError}
                  </p>
                )}
                <button
                  className="btn notificationSaveButton"
                  type="submit"
                  disabled={reminderSettingsSaving}
                >
                  {reminderSettingsSaving ? "Kaydediliyor..." : "Ayarları Kaydet"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
      {user && accountMenuOpen && (
        <div
          className="accountOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAccountMenuOpen(false);
          }}
        >
          <section
            className="accountMenu profileModal glass max-h-[88vh] overflow-y-auto p-5 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-menu-title"
          >
            <header className="accountMenuHeader">
              <div>
                <h2 id="account-menu-title">Profil</h2>
              </div>
              <button
                className="iconButton glass"
                type="button"
                onClick={() => setAccountMenuOpen(false)}
                aria-label="Hesap menüsünü kapat"
              >
                ×
              </button>
            </header>

            <div className="accountProfile">
              <div className="accountAvatarPreview">
                {profile?.avatarUrl ? (
                  <Image
                    src={profile.avatarUrl}
                    alt="Profil fotoğrafı"
                    width={76}
                    height={76}
                    unoptimized
                  />
                ) : (
                  <span>{user.email?.trim().charAt(0).toUpperCase() || "?"}</span>
                )}
              </div>
              <div className="accountAvatarActions">
                <strong>Profil fotoğrafı</strong>
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={() => avatarFileInput.current?.click()}
                  disabled={avatarUploading}
                >
                  {avatarUploading ? "Yükleniyor..." : "Fotoğraf Yükle / Değiştir"}
                </button>
                <input
                  ref={avatarFileInput}
                  className="visuallyHidden"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFile}
                  aria-label="Profil fotoğrafı seç"
                />
              </div>
            </div>
            {avatarError && <p className="accountError" role="alert">{avatarError}</p>}
            {profileError && <p className="accountError" role="alert">{profileError}</p>}

            <div className="accountDetail">
              <span>E-posta</span>
              <strong>{user.email || "E-posta bilgisi yok"}</strong>
            </div>
            <div className="accountDetail planDetail">
              <span>Üyelik Planı</span>
              <div className="planValue">
                {isXL ? (
                  <div className="planActiveSummary">
                    <strong className="planBadge">Fiyor₺X XL Aktif</strong>
                    {profile?.planSource === "trial" && trialDaysRemaining !== null && (
                      <span>{trialDaysRemaining} gün deneme kaldı</span>
                    )}
                  </div>
                ) : (
                  <>
                    <strong className="planBadge">L Plan (Ücretsiz)</strong>
                    <button
                      className="btn secondary small"
                      type="button"
                      onClick={openXLUpgrade}
                    >
                      Fiyor₺X XL&apos;ye Geç
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="accountDataActions">
              <button
                className="btn secondary accountActionButton accountExportButton w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium"
                type="button"
                onClick={exportUserData}
                disabled={!loaded || loadedUserId !== user.id}
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3v12m0 0 4-4m-4 4-4-4M5 16v4h14v-4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Verilerimi İndir (CSV)
              </button>
            </div>

            <button
              className="btn secondary accountActionButton accountSignOut w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium"
              type="button"
              onClick={signOut}
            >
              <AppIcon name="logout" size={16} className="w-4 h-4 shrink-0" />
              Çıkış Yap
            </button>

            <section
              className="accountDangerZone rounded-xl border border-red-500/20 bg-red-950/20 p-3.5 space-y-2.5"
              aria-labelledby="account-delete-heading"
            >
              <div>
                <h3 id="account-delete-heading">Hesabı Kalıcı Olarak Sil</h3>
                <p>Hesabın ve ilişkili verilerin geri döndürülemez şekilde silinir.</p>
              </div>
              <button
                className="btn danger accountActionButton accountDeleteStart w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium"
                type="button"
                onClick={() => {
                  setDeleteAccountConfirmation("");
                  setDeleteAccountError("");
                  setDeleteAccountModalOpen(true);
                }}
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Hesabımı Sil
              </button>
            </section>
          </section>
        </div>
      )}
      {user && deleteAccountModalOpen && (
        <div
          className="deleteConfirmOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingAccount) {
              setDeleteAccountModalOpen(false);
              setDeleteAccountConfirmation("");
              setDeleteAccountError("");
            }
          }}
        >
          <section
            className="deleteConfirmModal deleteAccountModal glass"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            aria-busy={deletingAccount}
          >
            <div className="deleteConfirmIcon deleteAccountWarningIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 8v5m0 3h.01M10.3 3.9 1.9 18.4A1.8 1.8 0 0 0 3.5 21h17a1.8 1.8 0 0 0 1.6-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h2 id="delete-account-title">Hesabın kalıcı olarak silinsin mi?</h2>
            <p id="delete-account-description">
              Tüm işlemlerin, sabit gelir ve gider kayıtların, borç ve bakiye bilgilerin,
              profilin ve profil fotoğrafın kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </p>
            <div className="deleteAccountConfirmField">
              <label htmlFor="delete-account-confirmation">Devam etmek için SİL yaz.</label>
              <input
                id="delete-account-confirmation"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={deleteAccountConfirmation}
                onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                disabled={deletingAccount}
                placeholder="SİL"
              />
            </div>
            {deleteAccountError && (
              <p className="accountError deleteAccountError" role="alert">
                {deleteAccountError}
              </p>
            )}
            <div className="deleteConfirmActions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setDeleteAccountModalOpen(false);
                  setDeleteAccountConfirmation("");
                  setDeleteAccountError("");
                }}
                disabled={deletingAccount}
              >
                İptal
              </button>
              <button
                className="btn danger deleteConfirmDanger"
                type="button"
                onClick={deleteOwnAccount}
                disabled={deleteAccountConfirmation !== "SİL" || deletingAccount}
              >
                {deletingAccount ? "Siliniyor..." : "Kalıcı Olarak Sil"}
              </button>
            </div>
          </section>
        </div>
      )}
      {user && (pendingDeleteTransaction || pendingDeleteGoal) && (
        <div
          className="deleteConfirmOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingTransactionId && !deletingGoal) {
              setPendingDeleteId(null);
              setPendingDeleteGoalId(null);
            }
          }}
        >
          <section
            className="deleteConfirmModal glass"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-item-title"
            aria-describedby="delete-item-description"
            aria-busy={Boolean(deletingTransactionId) || deletingGoal}
          >
            <div className="deleteConfirmIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 8v5m0 3h.01M10.3 3.9 1.9 18.4A1.8 1.8 0 0 0 3.5 21h17a1.8 1.8 0 0 0 1.6-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h2 id="delete-item-title">
              {pendingDeleteGoal ? "Hedef silinsin mi?" : "İşlem silinsin mi?"}
            </h2>
            <div className="deleteConfirmTransaction">
              {pendingDeleteGoal ? (
                <strong>{pendingDeleteGoal.title}</strong>
              ) : (
                <>
                  <strong>
                    {pendingDeleteTransaction?.type === "transfer"
                      ? "Transfer"
                      : pendingDeleteTransaction
                        ? transactionDisplayCategory(pendingDeleteTransaction)
                        : ""}
                  </strong>
                  <span className={`amount ${pendingDeleteTransaction?.type ?? "expense"}`}>
                    {pendingDeleteTransaction?.type === "income"
                      ? "+"
                      : pendingDeleteTransaction?.type === "expense"
                        ? "−"
                        : "↔ "}
                    {formatMoney(pendingDeleteTransaction?.amount ?? 0, privacyMode)}
                  </span>
                </>
              )}
            </div>
            <p id="delete-item-description">
              {pendingDeleteGoal
                ? "Bu birikim hedefini kalıcı olarak silmek istediğine emin misin?"
                : "Bu işlemi geri almak istediğine emin misin?"}
            </p>
            <div className="deleteConfirmActions">
              <button
                ref={deleteCancelButtonRef}
                className="btn secondary"
                type="button"
                onClick={() => {
                  setPendingDeleteId(null);
                  setPendingDeleteGoalId(null);
                }}
                disabled={Boolean(deletingTransactionId) || deletingGoal}
              >
                İptal
              </button>
              <button
                className="btn danger deleteConfirmDanger"
                type="button"
                onClick={() => {
                  if (pendingDeleteGoal) void deleteSavingsGoal(pendingDeleteGoal.id);
                  else if (pendingDeleteTransaction) {
                    void undoTransaction(pendingDeleteTransaction.id);
                  }
                }}
                disabled={Boolean(deletingTransactionId) || deletingGoal}
              >
                {deletingTransactionId || deletingGoal ? "Siliniyor..." : "Evet, Sil"}
              </button>
            </div>
          </section>
        </div>
      )}
      {user && savingsGoalModalOpen && (
        <div
          className="accountOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingGoal) {
              setSavingsGoalModalOpen(false);
            }
          }}
        >
          <section
            className="deleteConfirmModal glass savingsGoalModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="savings-goal-modal-title"
          >
            <h2 id="savings-goal-modal-title">Birikim Hedefi Ekle</h2>
            <p>Yeni hedefinin adını ve tutarını belirle.</p>
            <form className="savingsGoalForm" onSubmit={addSavingsGoal}>
              <div className="field">
                <label htmlFor="savings-goal-title">Hedef Adı</label>
                <input
                  id="savings-goal-title"
                  type="text"
                  value={savingsGoalTitle}
                  onChange={(event) => setSavingsGoalTitle(event.target.value)}
                  placeholder="Tatil, Acil Durum..."
                  maxLength={70}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="savings-goal-target">Hedef Tutar (₺)</label>
                <input
                  id="savings-goal-target"
                  type="text"
                  inputMode="decimal"
                  value={savingsGoalTarget}
                  onChange={(event) => setSavingsGoalTarget(event.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="savings-goal-initial">Başlangıç Tutarı (isteğe bağlı)</label>
                <input
                  id="savings-goal-initial"
                  type="text"
                  inputMode="decimal"
                  value={savingsGoalInitial}
                  onChange={(event) => setSavingsGoalInitial(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="deleteConfirmActions">
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setSavingsGoalModalOpen(false)}
                  disabled={savingGoal}
                >
                  İptal
                </button>
                <button className="btn success" type="submit" disabled={savingGoal}>
                  {savingGoal ? "Kaydediliyor..." : "Hedefi Kaydet"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {user && monthlyLimitModalOpen && (
        <div
          className="accountOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !monthlyLimitSaving) {
              setMonthlyLimitModalOpen(false);
            }
          }}
        >
          <section
            className="accountMenu monthlyLimitModal glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="monthly-limit-title"
          >
            <header className="accountMenuHeader">
              <div>
                <h2 id="monthly-limit-title">Aylık Harcama Limiti</h2>
                <p>Bu ayın fiyort sularını ve buzlaşma durumunu takip et.</p>
              </div>
              <button
                className="iconButton glass"
                type="button"
                onClick={() => setMonthlyLimitModalOpen(false)}
                aria-label="Limit ayarlarını kapat"
                disabled={monthlyLimitSaving}
              >
                ×
              </button>
            </header>

            <ol className="monthlyLimitTutorial">
              <li>Bu ayın giderlerini canlı takip eder; transfer ve kredi kartı borç ödemelerini saymaz.</li>
              <li>Harcama arttıkça fiyort suyu koyulaşır ve kırağı tutmaya başlar.</li>
              <li>Limite ulaştığında bar donar ve limit aşıldığını gösterir.</li>
            </ol>

            <form className="monthlyLimitForm" onSubmit={saveMonthlyLimit}>
              <div className="field">
                <label htmlFor="monthly-limit-amount">Aylık Limit</label>
                <input
                  id="monthly-limit-amount"
                  type="text"
                  inputMode="decimal"
                  value={privacyMode ? MASKED_MONEY : monthlyLimitDraft}
                  readOnly={privacyMode}
                  onChange={(event) => setMonthlyLimitDraft(event.target.value)}
                  placeholder="Örn. 25.000"
                  disabled={monthlyLimitSaving}
                />
              </div>
              {monthlyLimitError && (
                <p className="monthlyLimitError" role="alert">
                  {monthlyLimitError}
                </p>
              )}
              <div className="monthlyLimitModalActions">
                <button className="btn" type="submit" disabled={monthlyLimitSaving}>
                  {monthlyLimitSaving ? "Kaydediliyor..." : "Limiti Kaydet"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={disableMonthlyLimit}
                  disabled={monthlyLimit === null || monthlyLimitSaving}
                >
                  Barı Kapat / Kullanma
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {user && xlUpgradeOpen && (
        <div
          className="accountOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setXLUpgradeOpen(false);
          }}
        >
          <section
            className="planUpgradeModal glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="xl-upgrade-title"
          >
            <header className="accountMenuHeader">
              <div>
                <h2 id="xl-upgrade-title">Fiyor₺X XL</h2>
                <p>Finans akışını daha geniş bir zaman aralığında yönet.</p>
              </div>
              <button
                className="iconButton glass"
                type="button"
                onClick={() => setXLUpgradeOpen(false)}
                aria-label="XL plan penceresini kapat"
              >
                ×
              </button>
            </header>

            <div className="planComparisonScroll">
              <table className="planComparisonTable">
                <thead>
                  <tr>
                    <th scope="col">Özellik</th>
                    <th scope="col">L Plan</th>
                    <th scope="col">XL Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {planComparisonRows.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td>{row.free}</td>
                      <td>
                        {row.comingSoon ? (
                          <span className="comingSoonBadge">{row.xl}</span>
                        ) : (
                          row.xl
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="xlPriceCard">
              <div>
                <strong>
                  {currentXLPrice === 44
                    ? "30 Aralık 2026'ya kadar Kurucu Fiyat"
                    : "XL Plan fiyatı"}
                </strong>
                <span>
                  ₺{currentXLPrice}/ay
                  {currentXLPrice === 44 && (
                    <del>₺66/ay</del>
                  )}
                </span>
              </div>
              <p>
                {currentXLPrice === 44
                  ? "Kurucu fiyatı 30 Aralık 2026 dahil geçerlidir."
                  : "Kurucu fiyat dönemi sona erdi."}
              </p>
              <button className="btn xlPurchasePending" type="button" disabled>
                XL&apos;ye Geç (Play Store Ödemesi Yakında)
              </button>
            </div>
          </section>
        </div>
      )}
      <div
        className={`fixed inset-0 z-50 bg-[#0B1528] transition-opacity duration-300 ${
          isLoading ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!isLoading}
      >
        <Image
          src="/fiyor-splash.jpg"
          alt=""
          fill
          sizes="100vw"
          preload
          className="object-cover"
        />
      </div>
    </>
  );
}

function EditableMoneyCard({
  label,
  icon,
  value,
  privacyMode,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: number;
  privacyMode: boolean;
  onChange: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(() =>
    Number.isFinite(value) ? String(value) : "",
  );

  useEffect(() => {
    setDraftValue(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <div className="card glass editableMoneyCard">
      <div className="accountCardHeading">
        <AppIcon name={icon} size={16} className="w-4 h-4" />
        <div className="cardLabel">{label}</div>
      </div>
      <input
        className="moneyInput"
        type="text"
        inputMode="decimal"
        aria-label={`${label} bakiyesi`}
        value={privacyMode ? MASKED_MONEY : draftValue}
        readOnly={privacyMode}
        onChange={(event) => {
          setDraftValue(event.target.value);
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function ReadonlyMoneyCard({
  label,
  value,
  icon,
  iconTone,
  trend,
}: {
  label: string;
  value: string;
  icon?: IconName;
  iconTone?: "income" | "expense" | "net" | "count";
  trend?: MetricTrend;
}) {
  return (
    <div className={`card glass ${icon ? "metricCard" : ""}`}>
      <div className="metricCardHeading">
        {icon && (
          <span className={`metricIconBadge ${iconTone ?? "net"}`} aria-hidden="true">
            <AppIcon name={icon} size={17} />
          </span>
        )}
        <div className="cardLabel">{label}</div>
      </div>
      <div className="cardValue readonlyTotal">{value}</div>
      {trend && <TrendIndicator trend={trend} />}
    </div>
  );
}

function TrendIndicator({ trend }: { trend: MetricTrend }) {
  const icon =
    trend.direction === "up"
      ? "trendUp"
      : trend.direction === "down"
        ? "trendDown"
        : "trendFlat";

  return (
    <div className={`trendIndicator ${trend.tone}`}>
      <AppIcon name={icon} size={14} />
      <span>{trend.label}</span>
    </div>
  );
}

function MonthlyLimitBar({
  spent,
  limit,
  privacyMode,
  onOpen,
}: {
  spent: number;
  limit: number;
  privacyMode: boolean;
  onOpen: () => void;
}) {
  const safeSpent = Number.isFinite(spent) ? Math.max(spent, 0) : 0;
  const ratio = limit > 0 ? (safeSpent / limit) * 100 : 0;
  const tier =
    ratio >= 95 ? "frozen" : ratio >= 75 ? "freezing" : ratio >= 50 ? "deep" : "water";

  return (
    <div className={`monthlyLimitWidget tier-${tier}`}>
      <div className="monthlyLimitTopline">
        <span className="monthlyLimitTitle">Fiyort Barı</span>
        <div className="monthlyLimitMeta">
          <span className="monthlyLimitHeaderPercent">
            {privacyMode ? "••%" : `%${Math.floor(ratio)}`}
          </span>
          <button
            className="monthlyLimitSettings"
            type="button"
            onClick={onOpen}
            aria-label="Aylık harcama limitini düzenle"
            title="Limit ayarları"
          >
            <AppIcon name="settings" size={14} />
          </button>
        </div>
      </div>

      <div
        className="monthlyLimitTrack"
        role="progressbar"
        aria-label={`Aylık harcama limiti: ${formatMoney(safeSpent, privacyMode)} / ${formatMoney(limit, privacyMode)}`}
        title={`${formatMoney(safeSpent, privacyMode)} / ${formatMoney(limit, privacyMode)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(ratio))}
      >
        <div
          className={`monthlyLimitFill tier-${tier}`}
          style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
        />
      </div>
    </div>
  );
}

function AppIcon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  let shape: ReactNode;

  switch (name) {
    case "home":
      shape = (
        <>
          <path d="m3 10 9-7 9 7" />
          <path d="M5 9v12h14V9M9 21v-8h6v8" />
        </>
      );
      break;
    case "transfer":
      shape = (
        <>
          <path d="M4 7h15l-3-3m3 3-3 3" />
          <path d="M20 17H5l3 3m-3-3 3-3" />
        </>
      );
      break;
    case "history":
      shape = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      );
      break;
    case "analysis":
      shape = (
        <>
          <path d="M4 20V11m5 9V5m6 15v-7m5 7V8" />
          <path d="M2 20h20" />
        </>
      );
      break;
    case "logout":
      shape = (
        <>
          <path d="M10 17l5-5-5-5m5 5H3" />
          <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
        </>
      );
      break;
    case "cash":
      shape = (
        <>
          <rect x="2.5" y="5.5" width="19" height="13" rx="1.5" />
          <path d="M5 8h2V7m10 0v1h2M5 16h2v1m10 0v-1h2M8 8.5h8" />
          <text
            x="12"
            y="14.8"
            fill="currentColor"
            fontSize="7"
            fontWeight="700"
            stroke="none"
            textAnchor="middle"
          >
            ₺
          </text>
        </>
      );
      break;
    case "bank":
      shape = (
        <>
          <path d="m3 9 9-6 9 6M4 10h16M5 20h14M7 10v10m5-10v10m5-10v10" />
        </>
      );
      break;
    case "creditCard":
      shape = (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18m-14 5h4" />
        </>
      );
      break;
    case "benefit":
      shape = (
        <>
          <path d="M3.5 17.5V9.8a1.9 1.9 0 0 1 3.5-.9l2.1 4.4 2.2-4.4a1.9 1.9 0 0 1 3.4.9v7.7" />
          <path d="M14.7 14.2c2.3.2 4.1 1.2 5.8 3.3m-5.8 0c1.9-2.3 3.7-3.1 5.8-3.3" />
        </>
      );
      break;
    case "savings":
      shape = (
        <>
          <path d="M5 5.5h13a2 2 0 0 1 2 2v8" />
          <path d="M3.5 8h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
          <path d="M10 8v11m-2-6h4" />
        </>
      );
      break;
    case "income":
      shape = <path d="M12 19V5m-7 7 7-7 7 7" />;
      break;
    case "expense":
      shape = <path d="M12 5v14m7-7-7 7-7-7" />;
      break;
    case "net":
      shape = (
        <>
          <path d="M3 17c3-8 5 5 8-2s5-7 10-7" />
          <path d="M16 8h5v5" />
        </>
      );
      break;
    case "count":
      shape = (
        <>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </>
      );
      break;
    case "trendUp":
      shape = <path d="m5 16 6-6 4 4 5-7m-5 0h5v5" />;
      break;
    case "trendDown":
      shape = <path d="m5 8 6 6 4-4 5 7m-5 0h5v-5" />;
      break;
    case "trendFlat":
      shape = <path d="M4 12h16" />;
      break;
    case "eye":
      shape = (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
      break;
    case "eyeOff":
      shape = (
        <>
          <path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.2 3.6M6.2 6.3C3.9 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.7-.5" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      );
      break;
    case "snowflake":
      shape = (
        <>
          <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07" />
          <path d="m9 5 3 2 3-2m-6 14 3-2 3 2M5 9l2 3-2 3m14-6-2 3 2 3" />
        </>
      );
      break;
    case "settings":
      shape = (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" />
        </>
      );
      break;
    case "bell":
      shape = (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </>
      );
      break;
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function PlanLockIcon() {
  return (
    <svg className="planLockIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z" />
    </svg>
  );
}

function MonthSelector({
  value,
  currentMonth,
  onChange,
  locked = false,
  onLocked,
}: {
  value: string | null;
  currentMonth: string;
  onChange: (month: string | null) => void;
  locked?: boolean;
  onLocked?: () => void;
}) {
  function moveMonth(offset: number) {
    if (locked) {
      onLocked?.();
      return;
    }
    onChange(shiftMonth(value ?? currentMonth, offset));
  }

  return (
    <div className="monthControl glass" role="group" aria-label="Ay filtresi">
      <button
        className={`monthArrow ${locked ? "lockedPlanOption" : ""}`}
        type="button"
        aria-label="Önceki ay"
        aria-disabled={locked}
        onClick={() => moveMonth(-1)}
      >
        ‹
      </button>
      <span className="monthLabel" aria-live="polite">
        {value ? formatMonthLabel(value) : "Tüm Zamanlar"}
      </span>
      <button
        className={`monthArrow ${locked ? "lockedPlanOption" : ""}`}
        type="button"
        aria-label="Sonraki ay"
        aria-disabled={locked}
        onClick={() => moveMonth(1)}
      >
        ›
      </button>
      <button
        className={`monthAllButton ${value === null ? "active" : ""} ${locked ? "lockedPlanOption" : ""}`}
        type="button"
        aria-pressed={value === null}
        aria-disabled={locked}
        onClick={() => (locked ? onLocked?.() : onChange(null))}
      >
        Tümü
      </button>
    </div>
  );
}

async function resizeAvatarImage(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Görsel açılamadı."));
      image.src = objectUrl;
    });

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Görsel tuvali oluşturulamadı.");

    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.78),
    );
    if (!blob) throw new Error("Görsel JPEG olarak kaydedilemedi.");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function CategoryBars({
  data,
  privacyMode,
}: {
  data: {
    category: string;
    total: number;
    color: string;
  }[];
  privacyMode: boolean;
}) {
  const max = Math.max(...data.map((item) => item.total), 1);

  if (data.length === 0) {
    return <Empty text="Gider kategorisi bulunamadı." />;
  }

  return (
    <div className="bars">
      {data.map((item) => {
        const percent = Math.max(5, (item.total / max) * 100);

        return (
          <div className="barLine" key={item.category}>
            <strong>{item.category}</strong>

            <div className="barTrack">
              <div
                className="barFill"
                style={{
                  width: `${percent}%`,
                  background: item.color,
                }}
              />
            </div>

            <strong>{formatMoney(item.total, privacyMode)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function FlowChart({
  data,
  privacyMode,
}: {
  data: {
    month: string;
    income: number;
    expense: number;
    net: number;
    topCategory: string;
    topCategoryTotal: number;
  }[];
  privacyMode: boolean;
}) {
  if (data.length === 0) {
    return <Empty text="Akış grafiği için işlem bulunamadı." />;
  }

  const maxAbs = Math.max(
    ...data.map((item) => Math.max(Math.abs(item.income), Math.abs(item.expense), Math.abs(item.net))),
    1,
  );
  const chartHeight = 240;
  const baseY = 190;
  const barMaxHeight = 145;
  const groupWidth = 86;
  const gap = 34;
  const width = Math.max(620, data.length * (groupWidth + gap) + 80);
  const startX = data.length === 1 ? (width - groupWidth) / 2 : 44;

  return (
    <div className="chartBox">
      <svg
        className="flowSvg"
        width={width}
        height={chartHeight + 70}
        viewBox={`0 0 ${width} ${chartHeight + 70}`}
        role="img"
      >
        {[baseY - barMaxHeight, baseY - (barMaxHeight * 2) / 3, baseY - barMaxHeight / 3].map(
          (y) => (
            <line
              key={y}
              x1="24"
              x2={width - 24}
              y1={y}
              y2={y}
              stroke="rgba(56, 189, 248, 0.15)"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
          ),
        )}
        <line
          x1="24"
          x2={width - 24}
          y1={baseY}
          y2={baseY}
          stroke="rgba(56, 189, 248, 0.3)"
          strokeWidth="1"
        />

        {data.map((item, index) => {
          const x = startX + index * (groupWidth + gap);
          const incomeHeight = (Math.abs(item.income) / maxAbs) * barMaxHeight;
          const expenseHeight = (Math.abs(item.expense) / maxAbs) * barMaxHeight;
          const netHeight = (Math.abs(item.net) / maxAbs) * barMaxHeight;

          return (
            <g key={item.month}>
              <rect
                x={x}
                y={baseY - incomeHeight}
                width="22"
                height={incomeHeight}
                rx="8"
                fill="#059669"
              />

              <rect
                x={x + 30}
                y={baseY - expenseHeight}
                width="22"
                height={expenseHeight}
                rx="8"
                fill="#DC2626"
              />

              <rect
                x={x + 60}
                y={baseY - netHeight}
                width="22"
                height={netHeight}
                rx="8"
                fill={item.net >= 0 ? "#0284C7" : "#DC2626"}
              />

              <text
                x={x + 41}
                y={chartHeight + 4}
                textAnchor="middle"
                fill="#E2E8F0"
                fontSize="12"
                fontWeight="800"
              >
                {formatMonth(item.month)}
              </text>

              <text
                x={x + 41}
                y={chartHeight + 24}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="12"
                fontWeight="900"
              >
                {item.topCategory}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flowCards">
        {data.map((item) => (
          <div className="flowCard glass" key={item.month}>
            <strong>{formatMonth(item.month)}</strong>
            <span>Gelir: {formatMoney(item.income, privacyMode)}</span>
            <span>Gider: {formatMoney(item.expense, privacyMode)}</span>
            <span>Net: {formatMoney(item.net, privacyMode)}</span>
            <span>
              Baskın gider: {item.topCategory}
              {item.topCategoryTotal > 0 ? ` / ${formatMoney(item.topCategoryTotal, privacyMode)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChart({
  incomeData,
  expenseData,
  netFlow,
  privacyMode,
}: {
  incomeData: {
    category: string;
    total: number;
    color: string;
  }[];
  expenseData: {
    category: string;
    total: number;
    color: string;
  }[];
  netFlow: number;
  privacyMode: boolean;
}) {
  const incomeTotal = incomeData.reduce((sum, item) => sum + item.total, 0);
  const expenseTotal = expenseData.reduce((sum, item) => sum + item.total, 0);

  if (incomeTotal <= 0 && expenseTotal <= 0) {
    return <Empty text="Pasta grafiği için gider kategorisi bulunamadı." />;
  }

  const incomeCoversExpenses = incomeTotal >= expenseTotal;
  const coverageRatio =
    expenseTotal > 0 ? Math.min(incomeTotal / expenseTotal, 1) : 1;
  const incomeRingColor = "#22c55e";
  const uncoveredRingColor = "#b91c1c";
  const incomeRadius = 92;
  const expenseRadius = 62;
  const expenseSegments =
    expenseTotal > 0
      ? expenseData.map((item, index) => {
          const ratio = item.total / expenseTotal;
          const previousRatio = expenseData
            .slice(0, index)
            .reduce((sum, previousItem) => sum + previousItem.total / expenseTotal, 0);

          return {
            ...item,
            ratio,
            offset: -previousRatio * 100,
          };
        })
      : [];

  const renderLegendGroup = (
    title: string,
    emptyText: string,
    data: {
      category: string;
      total: number;
      color: string;
    }[],
    total: number,
  ) => {
    return (
      <div className="legendGroup">
        <div className="legendGroupHeader">
          <h3>{title}</h3>
          <span>{formatMoney(total, privacyMode)}</span>
        </div>

        {total <= 0 ? (
          <div className="legendEmpty">{emptyText}</div>
        ) : (
          <div className="legend">
            {data.map((item) => {
              const percent = (item.total / total) * 100;

              return (
                <div className="legendItem" key={`${title}-${item.category}`}>
                  <span className="legendColor" style={{ background: item.color }} />
                  <strong>{item.category}</strong>
                  <span>
                    {formatMoney(item.total, privacyMode)} · %{percent.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pieWrap">
      <svg
        className="pieSvg"
        viewBox="0 0 240 240"
        role="img"
        aria-label="Gelir ve gider dağılım pasta grafiği"
      >
        <circle
          cx="120"
          cy="120"
          r={incomeRadius}
          fill="none"
          stroke={incomeCoversExpenses ? incomeRingColor : uncoveredRingColor}
          strokeWidth="26"
        />

        {!incomeCoversExpenses && coverageRatio > 0 && (
          <circle
            cx="120"
            cy="120"
            r={incomeRadius}
            fill="none"
            stroke={incomeRingColor}
            strokeWidth="26"
            pathLength="100"
            strokeDasharray={`${coverageRatio * 100} ${100 - coverageRatio * 100}`}
            transform="rotate(-90 120 120)"
          />
        )}

        <circle
          cx="120"
          cy="120"
          r={expenseRadius}
          fill="none"
          stroke="rgba(56, 189, 248, 0.15)"
          strokeWidth="24"
        />

        {expenseSegments.map((item) => {
          return item.ratio > 0 ? (
            <circle
              key={`expense-${item.category}`}
              cx="120"
              cy="120"
              r={expenseRadius}
              fill="none"
              stroke={item.color}
              strokeWidth="24"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${item.ratio * 100} ${100 - item.ratio * 100}`}
              strokeDashoffset={item.offset}
              transform="rotate(-90 120 120)"
            />
          ) : null;
        })}

        <circle
          cx="120"
          cy="120"
          r="34"
          fill="#0B1528"
          stroke="rgba(56, 189, 248, 0.3)"
          strokeWidth="1.5"
        />

        <text
          x="120"
          y="108"
          textAnchor="middle"
          fill="#E2E8F0"
          fontSize="12"
          fontWeight="800"
        >
          Net Akış
        </text>
        <text
          x="120"
          y="132"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="16"
          fontWeight="950"
        >
          {formatMoney(netFlow, privacyMode)}
        </text>
      </svg>

      <div className="legendGroups">
        {renderLegendGroup("Gelirler", "Gelir yok", incomeData, incomeTotal)}
        {renderLegendGroup("Giderler", "Gider yok", expenseData, expenseTotal)}
      </div>
    </div>
  );
}