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
  | "settings";

type MetricTrend = {
  direction: "up" | "down" | "flat";
  tone: "positive" | "negative" | "neutral";
  label: string;
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

function sortByCreatedAscending(a: Transaction, b: Transaction) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function sortByDateNewest(a: Transaction, b: Transaction) {
  const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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
  const [monthlyLimit, setMonthlyLimit] = useState<number | null>(null);
  const [monthlyLimitModalOpen, setMonthlyLimitModalOpen] = useState(false);
  const [monthlyLimitDraft, setMonthlyLimitDraft] = useState("");
  const [monthlyLimitSaving, setMonthlyLimitSaving] = useState(false);
  const [monthlyLimitError, setMonthlyLimitError] = useState("");
  const [fixedIncomes, setFixedIncomes] = useState<FixedIncome[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [fixedIncomeError, setFixedIncomeError] = useState("");
  const [fixedIncomeType, setFixedIncomeType] = useState<"income" | "expense">("income");
  const [fixedIncomeTitle, setFixedIncomeTitle] = useState("");
  const [fixedIncomeAmount, setFixedIncomeAmount] = useState("");
  const [fixedIncomeAccount, setFixedIncomeAccount] = useState<AccountKey>("bank");
  const [fixedIncomeDay, setFixedIncomeDay] = useState("1");
  const avatarFileInput = useRef<HTMLInputElement | null>(null);
  const generatedIncomeKeys = useRef(new Set<string>());
  const generatedIncomeMonth = useRef("");

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loaded, setLoaded] = useState(false);

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

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => {
      setToastMessage("");
      toastTimer.current = null;
    }, 2500);
  }, []);

  function togglePrivacyMode() {
    localStorage.setItem(PRIVACY_STORAGE_KEY, String(!privacyMode));
    window.dispatchEvent(new Event(PRIVACY_EVENT));
  }

  useEffect(() => {
    if (!user) {
      setMonthlyLimit(null);
      return;
    }

    setMonthlyLimit(parseMonthlyLimit(localStorage.getItem(monthlyLimitStorageKey(user.id))));
  }, [user]);

  function openMonthlyLimitModal() {
    setMonthlyLimitDraft(monthlyLimit === null ? "" : String(monthlyLimit));
    setMonthlyLimitError("");
    setMonthlyLimitModalOpen(true);
  }

  async function persistMonthlyLimit(value: number | null) {
    if (!user) return false;

    setMonthlyLimit(value);
    setMonthlyLimitError("");
    try {
      localStorage.setItem(
        monthlyLimitStorageKey(user.id),
        value === null ? "null" : String(value),
      );
    } catch (error) {
      console.error("Aylık limit önbelleğe yazma hatası:", error);
      setMonthlyLimitError("Limit bu cihazda önbelleğe alınamadı.");
      return false;
    }
    setMonthlyLimitSaving(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ monthly_limit: value })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("Aylık limit kaydetme hatası:", error);
        setMonthlyLimitError("Limit Supabase'e kaydedilemedi. Şema ve izinleri kontrol edin.");
        return false;
      }

      if (!data) {
        setMonthlyLimitError("Profil kaydı bulunamadı. Sayfayı yenileyip tekrar deneyin.");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Aylık limit kaydetme hatası:", error);
      setMonthlyLimitError("Limit eşitlenemedi. İnternet bağlantınızı kontrol edin.");
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

    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setAvatarError("10 MB'dan küçük bir görsel dosyası seç.");
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
        setAvatarError("Fotoğraf yüklenemedi. Depolama izinlerini kontrol et.");
        return;
      }

      const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const avatarUrl = `${publicUrl.publicUrl}?v=${createId("avatar")}`;
      const { data: updatedProfile, error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("avatar_url,plan")
        .single();

      if (profileUpdateError) {
        console.error("Profil fotoğrafı kaydetme hatası:", profileUpdateError);
        setAvatarError("Fotoğraf yüklendi ancak profile kaydedilemedi.");
        return;
      }

      setProfile({
        avatarUrl: updatedProfile.avatar_url ? String(updatedProfile.avatar_url) : avatarUrl,
        plan: updatedProfile.plan === "pro" ? "pro" : "standard",
      });
      setAvatarError("");
      showToast("Profil fotoğrafı güncellendi.");
    } catch (error) {
      console.error("Profil fotoğrafı işleme hatası:", error);
      setAvatarError("Fotoğraf işlenemedi. Başka bir görsel deneyin.");
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

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handleAccountMenuKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    window.addEventListener("keydown", handleAccountMenuKeyDown);
    return () => window.removeEventListener("keydown", handleAccountMenuKeyDown);
  }, [accountMenuOpen]);

  // 0. KULLANICI OTURUMUNU DİNLEME
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 1. GİRİŞ YAPAN KULLANICININ VERİLERİNİ SUPABASE'DEN ÇEKME
  useEffect(() => {
    if (!user) {
      setLoaded(false);
      return;
    }

    let cancelled = false;

    async function loadFromSupabase() {
      try {
        const [balanceRes, txRes, debtRes, profileRes, fixedIncomeRes] = await Promise.all([
          supabase.from("base_balances").select("*").eq("user_id", user!.id).maybeSingle(),
          supabase.from("transactions").select("*").eq("user_id", user!.id),
          supabase.from("debts").select("*").eq("user_id", user!.id),
          supabase
            .from("profiles")
            .select("avatar_url,plan,monthly_limit")
            .eq("id", user!.id)
            .maybeSingle(),
          supabase
            .from("fixed_incomes")
            .select("id,type,title,amount,account,day_of_month,last_generated_month,created_at")
            .eq("user_id", user!.id),
        ]);

        if (cancelled) return;

        const dbBalances: BaseBalances = {
          cash: Number(balanceRes.data?.cash ?? 0),
          bank: Number(balanceRes.data?.bank ?? 0),
          benefit: Number(balanceRes.data?.benefit ?? 0),
          savings: Number(balanceRes.data?.savings ?? 0),
          creditDebt: Number(balanceRes.data?.credit_debt ?? 0),
        };

        const dbTransactions: Transaction[] = (txRes.data ?? []).map((row: any) => ({
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
          source: (row.source as "manual" | "debtPayment") ?? "manual",
          debtId: row.debt_id ? String(row.debt_id) : undefined,
        }));

        const dbDebts: Debt[] = (debtRes.data ?? []).map((row: any) => ({
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

        if (profileRes.error) {
          console.error("Profil yükleme hatası:", profileRes.error);
          setProfileError("Profil bilgileri yüklenemedi. Supabase şemanızı kontrol edin.");
        } else if (profileRes.data) {
          setProfile({
            avatarUrl: profileRes.data.avatar_url ? String(profileRes.data.avatar_url) : null,
            plan: profileRes.data.plan === "pro" ? "pro" : "standard",
          });
          const loadedMonthlyLimit = parseMonthlyLimit(
            profileRes.data.monthly_limit == null
              ? null
              : String(profileRes.data.monthly_limit),
          );
          setMonthlyLimit(loadedMonthlyLimit);
          localStorage.setItem(
            monthlyLimitStorageKey(user!.id),
            loadedMonthlyLimit === null ? "null" : String(loadedMonthlyLimit),
          );
          setProfileError("");
        } else {
          const cachedMonthlyLimit = parseMonthlyLimit(
            localStorage.getItem(monthlyLimitStorageKey(user!.id)),
          );
          const { data: createdProfile, error: createProfileError } = await supabase
            .from("profiles")
            .insert({ id: user!.id, monthly_limit: cachedMonthlyLimit })
            .select("avatar_url,plan,monthly_limit")
            .single();

          if (createProfileError) {
            console.error("Profil oluşturma hatası:", createProfileError);
            setProfileError("Profil oluşturulamadı. Supabase şemanızı kontrol edin.");
          } else {
            setProfile({
              avatarUrl: createdProfile.avatar_url ? String(createdProfile.avatar_url) : null,
              plan: createdProfile.plan === "pro" ? "pro" : "standard",
            });
            const createdMonthlyLimit = parseMonthlyLimit(
              createdProfile.monthly_limit == null
                ? null
                : String(createdProfile.monthly_limit),
            );
            setMonthlyLimit(createdMonthlyLimit);
            localStorage.setItem(
              monthlyLimitStorageKey(user!.id),
              createdMonthlyLimit === null ? "null" : String(createdMonthlyLimit),
            );
            setProfileError("");
          }
        }

        if (fixedIncomeRes.error) {
          console.error("Sabit gelirler yükleme hatası:", fixedIncomeRes.error);
          setFixedIncomeError("Sabit gelir/gider kayıtları yüklenemedi. Supabase şemanızı kontrol edin.");
        } else {
          setFixedIncomeError("");
        }

        setBaseBalances(dbBalances);
        setTransactions(dbTransactions);
        setDebts(dbDebts);
        setFixedIncomes(dbFixedIncomes);

        if (!fixedIncomeRes.error) {
          await generateDueFixedIncomes(dbFixedIncomes, user!);
        }

        if (cancelled) return;
        setLoaded(true);
      } catch (err) {
        console.error("Supabase yükleme hatası:", err);
        setLoaded(true);
      }
    }

    loadFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [generateDueFixedIncomes, user]);

  useEffect(() => {
    if (!loaded || !user) return;

    const data: PersistedState = {
      baseBalances,
      transactions,
      debts,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [baseBalances, transactions, debts, loaded, user]);

  function handleTransactionTypeChange(nextType: TransactionType) {
    setTxType(nextType);
    setTxIsConfirmed(nextType === "expense");
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
  const previousMonth = shiftMonth(currentMonth, -1);
  const previousMonthStart = `${previousMonth}-01`;
  const previousMonthEnd = endOfMonth(previousMonth);
  const hasPreviousMonthActivity = transactions.some(
    (item) =>
      item.date >= previousMonthStart &&
      item.date <= previousMonthEnd &&
      (item.type === "transfer" || item.isConfirmed),
  );
  const hasCurrentMonthActivity = transactions.some(
    (item) => item.date.slice(0, 7) === currentMonth,
  );
  const previousMonthBalances = useMemo(
    () =>
      calculateBalances(
        baseBalances,
        transactions.filter((item) => item.date <= previousMonthEnd),
      ),
    [baseBalances, previousMonthEnd, transactions],
  );
  const spendableBalanceTrend = hasPreviousMonthActivity
    ? getMetricTrend(balances.totalSpendable, previousMonthBalances.totalSpendable)
    : getFallbackTrend(hasCurrentMonthActivity ? "Bu ay aktif" : "Önceki ay verisi yok");
  const totalAssetsTrend = hasPreviousMonthActivity
    ? getMetricTrend(balances.totalAssets, previousMonthBalances.totalAssets)
    : getFallbackTrend(hasCurrentMonthActivity ? "Bu ay aktif" : "Önceki ay verisi yok");

  const openingNetEntry =
    baseBalances.cash +
    baseBalances.bank +
    baseBalances.savings -
    baseBalances.creditDebt;

  const analysisTransactions = useMemo(() => {
    return transactions.filter((item) => {
      if (item.type !== "transfer" && !item.isConfirmed) return false;
      return !selectedMonth || item.date.slice(0, 7) === selectedMonth;
    });
  }, [selectedMonth, transactions]);

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
    transactionSummary.totalExpense + baseBalances.creditDebt;

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
    const range = getTrendComparisonRange(selectedMonth);

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
    analysisTransactions,
    baseBalances.creditDebt,
    privacyMode,
    selectedMonth,
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
    const sorted = [...monthTransactions].sort(sortByDateNewest);
    if (historyFilter === "pending") {
      return sorted.filter((item) => item.type !== "transfer" && !item.isConfirmed);
    }
    if (historyFilter === "all") return sorted;
    return sorted.filter((item) => item.type === historyFilter);
  }, [historyFilter, selectedMonth, transactions]);

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
    const newTransaction: Transaction = {
      id: createId("tx"),
      date: transactionDate,
      type: txType,
      account: txAccount,
      toAccount: txType === "transfer" ? txTransferTarget : undefined,
      category: txType === "transfer" ? "Transfer" : txCategory.trim(),
      amount,
      note: txNote.trim(),
      createdAt: new Date().toISOString(),
      isConfirmed:
        txType === "transfer" ||
        (txIsConfirmed && transactionDate <= todayInputValue()),
      source: "manual",
    };

    setTransactions((current) => [newTransaction, ...current]);

    setTxAmount("");
    setTxNote("");
    setTxDate(todayInputValue());
    setTxIsConfirmed(txType === "expense");
    setActiveTab("history");

    const { error } = await supabase.from("transactions").insert({
      id: newTransaction.id,
      user_id: user.id,
      date: newTransaction.date,
      type: newTransaction.type,
      account: newTransaction.account,
      category: newTransaction.category,
      amount: newTransaction.amount,
      note: newTransaction.note,
      created_at: newTransaction.createdAt,
      is_confirmed: newTransaction.isConfirmed,
      source: newTransaction.source,
      ...(newTransaction.type === "transfer"
        ? { to_account: newTransaction.toAccount }
        : {}),
    });

    if (error) {
      console.error("İşlem ekleme hatası:", error);
    } else {
      showToast(txType === "transfer" ? "Transfer eklendi." : "İşlem eklendi.");
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
    if (pendingDeleteId !== transactionId) {
      setPendingDeleteId(transactionId);
      return;
    }

    const target = transactions.find((item) => item.id === transactionId);

    if (!target) return;

    if (target.source === "debtPayment" && target.debtId) {
      setDebts((current) =>
        current.map((debt) => {
          if (debt.id !== target.debtId) return debt;
          return {
            ...debt,
            paid: false,
            paidFrom: undefined,
            paidAt: undefined,
            paidTransactionId: undefined,
          };
        }),
      );
    }

    setTransactions((current) => current.filter((item) => item.id !== transactionId));
    setPendingDeleteId(null);

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", transactionId)
      .eq("user_id", user.id);
    if (error) {
      console.error("İşlem silme hatası:", error);
    } else {
      showToast("İşlem silindi.");
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
  const isLoading = !authReady || (!!user && !loaded);

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
        <header className="hero">
          <div className="brandWithLimit">
            <div className="brand">
              <div className="logoLine">
                <div className="logo rounded-2xl overflow-hidden">
                  <Image
                    className="logoImage"
                    src="/fiyor-logo.jpg"
                    alt="fiyor₺X logosu"
                    width={60}
                    height={60}
                    priority
                  />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">fiyor₺X</h1>
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
            <div className="miniStat">
              <span>Genel Harcanabilir</span>
              <strong>{formatMoney(balances.totalSpendable, privacyMode)}</strong>
              <TrendIndicator trend={spendableBalanceTrend} />
            </div>
            <div className="miniStat">
              <span>Toplam Varlık</span>
              <strong>{formatMoney(balances.totalAssets, privacyMode)}</strong>
              <TrendIndicator trend={totalAssetsTrend} />
            </div>
          </div>
          <div className="heroActions">
            <button
              className="iconButton glass"
              type="button"
              onClick={togglePrivacyMode}
              aria-label={privacyMode ? "Tutarları göster" : "Tutarları gizle"}
              aria-pressed={privacyMode}
              title={privacyMode ? "Tutarları göster" : "Tutarları gizle"}
            >
              <AppIcon name={privacyMode ? "eyeOff" : "eye"} size={19} />
            </button>
            <button
              className="profileAvatar"
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

        <nav className="tabs">
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
                  <div className="historyEntry" key={item.id}>
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
                          {item.type !== "transfer" && <span>{item.category}</span>}
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
                            onClick={() => undoTransaction(item.id)}
                          >
                            {pendingDeleteId === item.id ? "Emin misin?" : "Geri Al"}
                          </button>
                          {pendingDeleteId === item.id && (
                            <button
                              className="btn secondary small"
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                            >
                              İptal
                            </button>
                          )}
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
              </div>
              <MonthSelector
                value={selectedMonth}
                currentMonth={currentMonth}
                onChange={setSelectedMonth}
              />
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
      {user && accountMenuOpen && (
        <div
          className="accountOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAccountMenuOpen(false);
          }}
        >
          <section
            className="accountMenu glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-menu-title"
          >
            <header className="accountMenuHeader">
              <div>
                <h2 id="account-menu-title">Hesap</h2>
                <p>Profil bilgilerini ve üyelik durumunu yönet.</p>
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
                <strong className="planBadge">
                  {profile?.plan === "pro" ? "Pro Plan" : "Standart Plan"}
                </strong>
                <button className="btn secondary small" type="button" disabled>
                  Pro&apos;ya Yükselt (Yakında)
                </button>
              </div>
            </div>

            <button className="btn danger accountSignOut" type="button" onClick={signOut}>
              <AppIcon name="logout" size={17} />
              Çıkış Yap
            </button>
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
        <AppIcon name={icon} size={15} />
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
    ratio >= 100 ? "frozen" : ratio >= 76 ? "freezing" : ratio >= 46 ? "deep" : "water";
  const stateLabel = {
    water: "Açık Fiyort Suyu",
    deep: "Derin Buzul Suyu",
    freezing: "Donma Başlıyor",
    frozen: "Dondu / Aşıldı",
  }[tier];

  return (
    <div className={`monthlyLimitWidget tier-${tier}`}>
      <div className="monthlyLimitTopline">
        <div className="monthlyLimitReadout">
          <span>Aylık Harcama</span>
          <strong>
            {formatMoney(safeSpent, privacyMode)} / {formatMoney(limit, privacyMode)}
          </strong>
        </div>
        <button
          className="monthlyLimitSettings"
          type="button"
          onClick={onOpen}
          aria-label="Aylık harcama limitini düzenle"
          title="Limit ayarları"
        >
          <AppIcon name="settings" size={15} />
        </button>
      </div>

      <div
        className={`monthlyLimitTrack tier-${tier}`}
        role="progressbar"
        aria-label="Aylık harcama limiti"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(ratio))}
      >
        <div
          className={`monthlyLimitFill tier-${tier}`}
          style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
        />
        {tier === "frozen" && (
          <>
            <svg
              className="monthlyLimitIcicles top"
              viewBox="0 0 120 12"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 0h18l3 6 3-6h25l4 10 4-10h25l3 6 3-6h18v2h-18l-3 6-3-6H79l-4 9-4-9H57l-4 6-3-6H26l-3 6-3-6H0z" />
            </svg>
            <svg
              className="monthlyLimitIcicles bottom"
              viewBox="0 0 120 12"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 0h18l3 6 3-6h25l4 10 4-10h25l3 6 3-6h18v2h-18l-3 6-3-6H79l-4 9-4-9H57l-4 6-3-6H26l-3 6-3-6H0z" />
            </svg>
          </>
        )}
      </div>

      <div className="monthlyLimitFooter">
        <span>{stateLabel}</span>
        <span>{privacyMode ? "••%" : `%${Math.floor(ratio)}`}</span>
      </div>
    </div>
  );
}

function AppIcon({ name, size = 18 }: { name: IconName; size?: number }) {
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
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18m-9 2v1" />
          <circle cx="12" cy="13" r="2" />
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
          <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
          <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
        </>
      );
      break;
    case "savings":
      shape = (
        <>
          <path d="M5 10a7 7 0 0 1 12-2h3v6h-3a7 7 0 0 1-12 2H3v-5h2Z" />
          <circle cx="14" cy="11" r="1" />
          <path d="M8 7V4m-3 5L3 7m4 10v2" />
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
  }

  return (
    <svg
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

function MonthSelector({
  value,
  currentMonth,
  onChange,
}: {
  value: string | null;
  currentMonth: string;
  onChange: (month: string | null) => void;
}) {
  function moveMonth(offset: number) {
    onChange(shiftMonth(value ?? currentMonth, offset));
  }

  return (
    <div className="monthControl glass" role="group" aria-label="Ay filtresi">
      <button
        className="monthArrow"
        type="button"
        aria-label="Önceki ay"
        onClick={() => moveMonth(-1)}
      >
        ‹
      </button>
      <span className="monthLabel" aria-live="polite">
        {value ? formatMonthLabel(value) : "Tüm Zamanlar"}
      </span>
      <button
        className="monthArrow"
        type="button"
        aria-label="Sonraki ay"
        onClick={() => moveMonth(1)}
      >
        ›
      </button>
      <button
        className={`monthAllButton ${value === null ? "active" : ""}`}
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
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
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Görsel açılamadı."));
    });

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;

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
      canvas.toBlob(resolve, "image/jpeg", 0.82),
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