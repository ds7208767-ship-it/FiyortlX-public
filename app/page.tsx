"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import AuthScreen from "./AuthScreen";

import type {
  AccountKey,
  AnalysisMode,
  BaseBalances,
  Debt,
  PersistedState,
  TabKey,
  Transaction,
  TransactionType,
} from "../lib/types";

const STORAGE_KEY = "fiyortx-app-v4";

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
  | "trendFlat";

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

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(value: string, dayOffset: number) {
  const date = parseDateInput(value);
  date.setDate(date.getDate() + dayOffset);
  return dateInputFromDate(date);
}

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `%${new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 1,
  }).format(safeValue)}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatSignedMoney(value: number) {
  if (value > 0) return `+${formatMoney(value)}`;
  if (value < 0) return `-${formatMoney(Math.abs(value))}`;
  return formatMoney(0);
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

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + offset;
  const shiftedYear = Math.floor(monthIndex / 12);
  const shiftedMonth = monthIndex - shiftedYear * 12 + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

function startOfWeek(value: string) {
  const date = parseDateInput(value);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return dateInputFromDate(date);
}

function endOfMonth(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  return dateInputFromDate(new Date(year, month, 0));
}

function previousYearDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year - 1, month - 1, day);
  return dateInputFromDate(date);
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
    if (item.type === "expense") {
      totalExpense += item.amount;
      expenseByCategory[item.category] = (expenseByCategory[item.category] ?? 0) + item.amount;
    }
    if (item.type === "expense" || item.isConfirmed) transactionCount += 1;
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
    if (item.type === "expense") {
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

function getTrendComparisonRange(
  analysisPeriod: string,
  analysisReferenceDate: string,
  analysisCustomStart: string,
  analysisCustomEnd: string,
) {
  if (analysisPeriod === "all") return null;

  const today = analysisReferenceDate;
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);
  const nextMonth = shiftMonth(currentMonth, 1);
  let currentStart = "";
  let currentEnd = "";
  let previousStart = "";
  let previousEnd = "";

  if (analysisPeriod === "today") {
    currentStart = today;
    currentEnd = today;
    previousStart = shiftDate(today, -1);
    previousEnd = previousStart;
  }
  if (analysisPeriod === "this-week") {
    currentStart = startOfWeek(today);
    currentEnd = today;
    previousStart = shiftDate(currentStart, -7);
    previousEnd = shiftDate(currentStart, -1);
  }
  if (analysisPeriod === "this-month") {
    const previousMonth = shiftMonth(currentMonth, -1);
    currentStart = `${currentMonth}-01`;
    currentEnd = today;
    previousStart = `${previousMonth}-01`;
    previousEnd = endOfMonth(previousMonth);
  }
  if (analysisPeriod === "last-30-days") {
    currentStart = shiftDate(today, -29);
    currentEnd = today;
    previousStart = shiftDate(currentStart, -30);
    previousEnd = shiftDate(currentStart, -1);
  }
  if (analysisPeriod === "last-3-months") {
    currentStart = `${shiftMonth(currentMonth, -2)}-01`;
    currentEnd = today;
    previousStart = `${shiftMonth(currentMonth, -5)}-01`;
    previousEnd = endOfMonth(shiftMonth(currentMonth, -3));
  }
  if (analysisPeriod === "last-6-months") {
    currentStart = `${shiftMonth(currentMonth, -5)}-01`;
    currentEnd = today;
    previousStart = `${shiftMonth(currentMonth, -11)}-01`;
    previousEnd = endOfMonth(shiftMonth(currentMonth, -6));
  }
  if (analysisPeriod === "last-12-months") {
    currentStart = `${shiftMonth(currentMonth, -11)}-01`;
    currentEnd = today;
    previousStart = `${shiftMonth(currentMonth, -23)}-01`;
    previousEnd = endOfMonth(shiftMonth(currentMonth, -12));
  }
  if (analysisPeriod === "this-year") {
    currentStart = `${currentYear}-01-01`;
    currentEnd = today;
    previousStart = `${Number(currentYear) - 1}-01-01`;
    previousEnd = previousYearDate(today);
  }
  if (analysisPeriod === "next-month") {
    currentStart = `${nextMonth}-01`;
    currentEnd = endOfMonth(nextMonth);
    previousStart = `${currentMonth}-01`;
    previousEnd = endOfMonth(currentMonth);
  }
  if (analysisPeriod === "next-3-months") {
    currentStart = `${nextMonth}-01`;
    currentEnd = endOfMonth(shiftMonth(currentMonth, 3));
    previousStart = `${shiftMonth(currentMonth, -2)}-01`;
    previousEnd = endOfMonth(currentMonth);
  }
  if (analysisPeriod === "next-6-months") {
    currentStart = `${nextMonth}-01`;
    currentEnd = endOfMonth(shiftMonth(currentMonth, 6));
    previousStart = `${shiftMonth(currentMonth, -5)}-01`;
    previousEnd = endOfMonth(currentMonth);
  }
  if (analysisPeriod === "until-year-end") {
    currentStart = today;
    currentEnd = `${currentYear}-12-31`;
  }
  if (analysisPeriod === "custom") {
    currentStart = analysisCustomStart;
    currentEnd = analysisCustomEnd;
    if (currentStart && currentEnd && currentStart > currentEnd) {
      [currentStart, currentEnd] = [currentEnd, currentStart];
    }
  }

  if (!currentStart || !currentEnd) return null;

  if (!previousStart || !previousEnd) {
    const dayCount =
      Math.round(
        (parseDateInput(currentEnd).getTime() - parseDateInput(currentStart).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    previousStart = shiftDate(currentStart, -dayCount);
    previousEnd = shiftDate(currentStart, -1);
  }

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

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
  const [txIsConfirmed, setTxIsConfirmed] = useState(false);
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
  const [analysisPeriod, setAnalysisPeriod] = useState("this-month");
  const [analysisCustomStart, setAnalysisCustomStart] = useState("");
  const [analysisCustomEnd, setAnalysisCustomEnd] = useState("");

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => {
      setToastMessage("");
      toastTimer.current = null;
    }, 2500);
  }

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

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
        const [balanceRes, txRes, debtRes] = await Promise.all([
          supabase.from("base_balances").select("*").eq("user_id", user!.id).maybeSingle(),
          supabase.from("transactions").select("*").eq("user_id", user!.id),
          supabase.from("debts").select("*").eq("user_id", user!.id),
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

        setBaseBalances(dbBalances);
        setTransactions(dbTransactions);
        setDebts(dbDebts);
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
  }, [user]);

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
    setTxIsConfirmed(false);
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
  const previousMonth = shiftMonth(currentMonth, -1);
  const previousMonthStart = `${previousMonth}-01`;
  const previousMonthEnd = endOfMonth(previousMonth);
  const hasPreviousMonthActivity = transactions.some(
    (item) =>
      item.date >= previousMonthStart &&
      item.date <= previousMonthEnd &&
      (item.type !== "income" || item.isConfirmed),
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
    if (analysisPeriod === "all") {
      return transactions.filter((item) => item.type !== "income" || item.isConfirmed);
    }

    const today = analysisReferenceDate;
    const currentMonth = today.slice(0, 7);
    const currentYear = today.slice(0, 4);
    const nextMonth = shiftMonth(currentMonth, 1);
    let start = "";
    let end = "";

    if (analysisPeriod === "today") {
      start = today;
      end = today;
    }
    if (analysisPeriod === "this-week") {
      start = startOfWeek(today);
      end = today;
    }
    if (analysisPeriod === "this-month") {
      start = `${currentMonth}-01`;
      end = today;
    }
    if (analysisPeriod === "last-30-days") {
      start = shiftDate(today, -29);
      end = today;
    }
    if (analysisPeriod === "last-3-months") {
      start = `${shiftMonth(currentMonth, -2)}-01`;
      end = today;
    }
    if (analysisPeriod === "last-6-months") {
      start = `${shiftMonth(currentMonth, -5)}-01`;
      end = today;
    }
    if (analysisPeriod === "last-12-months") {
      start = `${shiftMonth(currentMonth, -11)}-01`;
      end = today;
    }
    if (analysisPeriod === "this-year") {
      start = `${currentYear}-01-01`;
      end = today;
    }
    if (analysisPeriod === "next-month") {
      start = `${nextMonth}-01`;
      end = endOfMonth(nextMonth);
    }
    if (analysisPeriod === "next-3-months") {
      start = `${nextMonth}-01`;
      end = endOfMonth(shiftMonth(currentMonth, 3));
    }
    if (analysisPeriod === "next-6-months") {
      start = `${nextMonth}-01`;
      end = endOfMonth(shiftMonth(currentMonth, 6));
    }
    if (analysisPeriod === "until-year-end") {
      start = today;
      end = `${currentYear}-12-31`;
    }
    if (analysisPeriod === "custom") {
      start = analysisCustomStart;
      end = analysisCustomEnd;
      if (start && end && start > end) {
        [start, end] = [end, start];
      }
    }

    return transactions.filter((item) => {
      if (item.type === "income" && !item.isConfirmed) return false;
      if (start && item.date < start) return false;
      if (end && item.date > end) return false;
      return true;
    });
  }, [analysisCustomEnd, analysisCustomStart, analysisPeriod, analysisReferenceDate, transactions]);

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
        `Bu dönemde gelirlerin giderlerinden yüksek. Net olarak +${formatMoney(transactionSummary.netFlow)} ileridesin.`,
      );
    } else if (transactionSummary.netFlow < 0) {
      items.push(
        `Bu dönemde giderlerin gelirlerinden yüksek. Net olarak -${formatMoney(Math.abs(transactionSummary.netFlow))} geridesin.`,
      );
    } else {
      items.push("Bu dönemde gelir ve giderlerin dengede. Net durum ₺0.");
    }

    if (topExpenseCategory) {
      items.push(
        `En çok harcama yaptığın kategori: ${topExpenseCategory.category} (${formatMoney(topExpenseCategory.total)}).`,
      );
    }

    if (transactionSummary.totalIncome === 0) {
      items.push("Bu dönemde gelir kaydı görünmüyor.");
    }

    if (transactionSummary.totalExpense === 0) {
      items.push("Bu dönemde gider kaydı görünmüyor.");
    }

    return items;
  }, [categoryData, transactionSummary.netFlow, transactionSummary.totalExpense, transactionSummary.totalIncome]);

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
          ? `${topIncomeCategory[0]} / ${formatMoney(topIncomeCategory[1])}`
          : "-",
        tone: "income",
      },
      {
        label: "En yüksek gider kategorisi",
        value: topExpenseCategory
          ? `${topExpenseCategory[0]} / ${formatMoney(topExpenseCategory[1])}`
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
        value: formatMoney(averageAmount),
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
          ? `${highestTransaction.category} / ${formatMoney(highestTransaction.amount)}`
          : "-",
        tone: "peak",
      },
      {
        label: "En yoğun harcama günü",
        value: topExpenseDay ? `${formatDate(topExpenseDay[0])} / ${formatMoney(topExpenseDay[1])}` : "-",
        tone: "expense",
      },
      {
        label: "En yoğun gelir günü",
        value: topIncomeDay ? `${formatDate(topIncomeDay[0])} / ${formatMoney(topIncomeDay[1])}` : "-",
        tone: "income",
      },
    ];
  }, [analysisTransactions, transactionSummary.totalExpense, transactionSummary.totalIncome]);

  const trendAnalysis = useMemo(() => {
    const range = getTrendComparisonRange(
      analysisPeriod,
      analysisReferenceDate,
      analysisCustomStart,
      analysisCustomEnd,
    );

    if (!range) {
      return {
        hasComparison: false,
        message: "Bu dönem için karşılaştırma yapılacak eşdeğer bir dönem bulunmuyor.",
        metricTrends: null,
        items: [],
      };
    }

    const previousTransactions = transactions.filter((item) => {
      if (item.type === "income" && !item.isConfirmed) return false;
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
          value: formatSignedMoney(netDiff),
          detail: buildTrendLabel(currentSummary.netFlow, previousSummary.netFlow, "Net durum iyileşti", "Net durum geriledi"),
          tone: getTrendTone(currentSummary.netFlow, previousSummary.netFlow),
        },
        {
          label: "En çok artan gider kategorisi",
          value: topIncreasedExpense
            ? `${topIncreasedExpense.category} / +${formatMoney(topIncreasedExpense.diff)}`
            : "-",
          detail: topIncreasedExpense ? "Önceki döneme göre artış" : "Artan kategori yok",
          tone: topIncreasedExpense ? "negative" : "neutral",
        },
        {
          label: "En çok azalan gider kategorisi",
          value: topDecreasedExpense
            ? `${topDecreasedExpense.category} / -${formatMoney(Math.abs(topDecreasedExpense.diff))}`
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
    analysisCustomEnd,
    analysisCustomStart,
    analysisPeriod,
    analysisReferenceDate,
    analysisTransactions,
    baseBalances.creditDebt,
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
    const sorted = [...transactions].sort(sortByDateNewest);
    if (historyFilter === "pending") {
      return sorted.filter((item) => item.type === "income" && !item.isConfirmed);
    }
    if (historyFilter === "all") return sorted;
    return sorted.filter((item) => item.type === historyFilter);
  }, [historyFilter, transactions]);

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
      category: txType === "transfer" ? "Transfer" : txCategory,
      amount,
      note: txNote.trim(),
      createdAt: new Date().toISOString(),
      isConfirmed:
        txType !== "income" ||
        (txIsConfirmed && transactionDate <= todayInputValue()),
      source: "manual",
    };

    setTransactions((current) => [newTransaction, ...current]);

    setTxAmount("");
    setTxNote("");
    setTxDate(todayInputValue());
    setTxIsConfirmed(false);
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
    if (!transaction || transaction.type !== "income" || transaction.isConfirmed === isConfirmed) {
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
      console.error("Gelir onay durumu güncelleme hatası:", error);
    } else if (isConfirmed) {
      showToast("Gelir onaylandı.");
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
      editType !== "income" ||
      (targetTransaction.type === "income" && targetTransaction.isConfirmed);
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

          <div className="heroStats">
            <div className="miniStat">
              <span>Genel Harcanabilir</span>
              <strong>{formatMoney(balances.totalSpendable)}</strong>
              <TrendIndicator trend={spendableBalanceTrend} />
            </div>
            <div className="miniStat">
              <span>Toplam Varlık</span>
              <strong>{formatMoney(balances.totalAssets)}</strong>
              <TrendIndicator trend={totalAssetsTrend} />
            </div>
          </div>
          <button
            className="btn secondary small logoutButton"
            type="button"
            onClick={() => supabase.auth.signOut()}
            aria-label="Çıkış Yap"
            title="Çıkış Yap"
          >
            <AppIcon name="logout" size={17} />
            <span className="logoutLabel">Çıkış Yap</span>
          </button>
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
                onChange={(value) => updateBaseBalance("cash", value)}
              />
              <EditableMoneyCard
                label="Banka"
                icon="bank"
                value={baseBalances.bank}
                onChange={(value) => updateBaseBalance("bank", value)}
              />
              <EditableMoneyCard
                label="Kredi Kartı Borcu"
                icon="creditCard"
                value={baseBalances.creditDebt}
                onChange={(value) => updateBaseBalance("creditDebt", value)}
              />
              <EditableMoneyCard
                label="Yan Hak"
                icon="benefit"
                value={baseBalances.benefit}
                onChange={(value) => updateBaseBalance("benefit", value)}
              />
              <EditableMoneyCard
                label="Birikim"
                icon="savings"
                value={baseBalances.savings}
                onChange={(value) => updateBaseBalance("savings", value)}
              />
            </div>

            <div className="grid overviewTotals">
              <ReadonlyMoneyCard label="Ana Para" value={formatMoney(balances.mainMoney)} />
              <ReadonlyMoneyCard
                label="Genel Harcanabilir"
                value={formatMoney(balances.totalSpendable)}
              />
              <ReadonlyMoneyCard
                label="Toplam Varlık"
                value={formatMoney(balances.totalAssets)}
              />
            </div>
          </section>
        )}

        {activeTab === "transaction" && (
          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>İşlem Ekle</h2>
                <p>Gelir, gider veya hesaplar arası transfer gir.</p>
              </div>
            </div>

            <form onSubmit={addTransaction} className="sectionStack">
              <div className="formGrid">
                <div className="field">
                  <label>İşlem Tipi</label>
                  <select
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

                <div className="field">
                  <label>{txType === "transfer" ? "Kaynak Hesap" : "Hesap"}</label>
                  <select
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
                </div>

                {txType === "transfer" ? (
                  <div className="field">
                    <label>Hedef Hesap</label>
                    <select
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
                  </div>
                ) : (
                  <div className="field">
                    <label>Kategori</label>
                    <select
                      value={txCategory}
                      onChange={(event) => setTxCategory(event.target.value)}
                    >
                      {(txType === "income" ? incomeCategories : expenseCategories).map(
                        (category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                )}

                <div className="field">
                  <label>Tutar</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={txAmount}
                    onChange={(event) => setTxAmount(event.target.value)}
                    placeholder="0"
                  />
                </div>

                <div className="field">
                  <label>Tarih</label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setTxDate(nextDate);
                      if (nextDate > todayInputValue()) setTxIsConfirmed(false);
                    }}
                  />
                </div>

                {txType === "income" && (
                  <div className="field full">
                    <label className="incomeConfirmationField">
                      <input
                        className="incomeConfirmationCheckbox"
                        type="checkbox"
                        checked={txIsConfirmed && !isFutureTransactionDate}
                        disabled={isFutureTransactionDate}
                        onChange={(event) => setTxIsConfirmed(event.target.checked)}
                      />
                      <span>Bu parayı aldım (bakiyeye hemen ekle)</span>
                    </label>
                    {isFutureTransactionDate && (
                      <span className="fieldHint">
                        İleri tarihli gelirler beklemede eklenir.
                      </span>
                    )}
                  </div>
                )}

                <div className="field full">
                  <label>Not</label>
                  <textarea
                    value={txNote}
                    onChange={(event) => setTxNote(event.target.value)}
                    placeholder="İsteğe bağlı not..."
                  />
                </div>
              </div>

              <div className="buttonRow">
                <button className="btn" type="submit">
                  {txType === "transfer" ? "Transferi Ekle" : "İşlemi Ekle"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setTxAmount("");
                    setTxNote("");
                    setTxDate(todayInputValue());
                    setTxIsConfirmed(false);
                  }}
                >
                  Temizle
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "history" && (
          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>Geçmiş</h2>
                <p>Eklenen işlemler burada listelenir.</p>
              </div>
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
                              item.type === "income" && !item.isConfirmed
                                ? "pending"
                                : item.type
                            }`}
                          >
                            {item.type === "transfer"
                              ? "Transfer"
                              : item.type === "income"
                                ? item.isConfirmed
                                  ? "Gelir"
                                  : "Bekliyor"
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
                            item.type === "income" && !item.isConfirmed ? "pending" : ""
                          }`}
                        >
                          {item.type === "income" ? "+" : item.type === "expense" ? "−" : "↔ "}
                          {formatMoney(item.amount)}
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
                          {item.type === "income" && (
                            <button
                              className={`btn small ${item.isConfirmed ? "secondary" : "success"}`}
                              type="button"
                              onClick={() =>
                                updateTransactionConfirmation(item.id, !item.isConfirmed)
                              }
                            >
                              {item.isConfirmed ? "Almadım" : "Aldım"}
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
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={editAmount}
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
                          <button className="btn success" type="submit">
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
            <section className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>GİRİŞ</h2>
                  <p>Genel sekmesinde kaydedilen ilk gün bakiyeleri.</p>
                </div>
              </div>

              <div className="grid cards analysisSummaryGrid openingSummaryGrid">
                <ReadonlyMoneyCard label="Nakit" value={formatMoney(baseBalances.cash)} />
                <ReadonlyMoneyCard label="Banka" value={formatMoney(baseBalances.bank)} />
                <ReadonlyMoneyCard
                  label="Kredi Kartı Borcu"
                  value={formatMoney(baseBalances.creditDebt)}
                />
                <ReadonlyMoneyCard label="Yan Hak" value={formatMoney(baseBalances.benefit)} />
                <ReadonlyMoneyCard label="Birikim" value={formatMoney(baseBalances.savings)} />
                <ReadonlyMoneyCard label="Net Giriş" value={formatMoney(openingNetEntry)} />
              </div>
            </section>

            <div className="grid cards analysisSummaryGrid transactionSummaryGrid">
              <ReadonlyMoneyCard
                label="Toplam Gelir"
                value={formatMoney(transactionSummary.totalIncome)}
                icon="income"
                iconTone="income"
                trend={analysisMetricTrends.income}
              />
              <ReadonlyMoneyCard
                label="Toplam Gider"
                value={formatMoney(totalExpenseIncludingOpeningDebt)}
                icon="expense"
                iconTone="expense"
                trend={analysisMetricTrends.expense}
              />
              <ReadonlyMoneyCard
                label="Net Akış"
                value={formatMoney(transactionSummary.netFlow)}
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
              <div className="sectionHeader">
                <div>
                  <h2>Analiz</h2>
                  <p>Bir görünüm seç.</p>
                </div>

                <div className="analysisFilters">
                  <div className="analysisPeriodField">
                    <label htmlFor="analysis-period">Dönem</label>
                    <select
                      id="analysis-period"
                      value={analysisPeriod}
                      onChange={(event) => setAnalysisPeriod(event.target.value)}
                    >
                      <optgroup label="Geçmiş">
                        <option value="today">Bugün</option>
                        <option value="this-week">Bu Hafta</option>
                        <option value="this-month">Bu Ay</option>
                        <option value="last-30-days">Son 30 Gün</option>
                        <option value="last-3-months">Son 3 Ay</option>
                        <option value="last-6-months">Son 6 Ay</option>
                        <option value="last-12-months">Son 12 Ay</option>
                        <option value="this-year">Bu Yıl</option>
                        <option value="all">Tüm Zamanlar</option>
                      </optgroup>
                      <optgroup label="Gelecek">
                        <option value="next-month">Gelecek Ay</option>
                        <option value="next-3-months">Sonraki 3 Ay</option>
                        <option value="next-6-months">Sonraki 6 Ay</option>
                        <option value="until-year-end">Yıl Sonuna Kadar</option>
                      </optgroup>
                      <optgroup label="Özel">
                        <option value="custom">Özel Tarih Aralığı</option>
                      </optgroup>
                    </select>
                  </div>

                  {analysisPeriod === "custom" && (
                    <div className="customDateFields">
                      <div className="field">
                        <label htmlFor="analysis-start">Başlangıç</label>
                        <input
                          id="analysis-start"
                          type="date"
                          value={analysisCustomStart}
                          onChange={(event) => setAnalysisCustomStart(event.target.value)}
                        />
                      </div>

                      <div className="field">
                        <label htmlFor="analysis-end">Bitiş</label>
                        <input
                          id="analysis-end"
                          type="date"
                          value={analysisCustomEnd}
                          onChange={(event) => setAnalysisCustomEnd(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

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
                  {analysisTransactions.length === 0 ? (
                    <Empty text="Seçilen dönem için işlem bulunamadı." />
                  ) : (
                    <>
                      {analysisMode === "category" && <CategoryBars data={categoryData} />}
                      {analysisMode === "flow" && <FlowChart data={monthlyFlowData} />}
                      {analysisMode === "pie" && (
                        <PieChart
                          incomeData={incomeData}
                          expenseData={categoryData}
                          netFlow={transactionSummary.netFlow}
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
  onChange,
}: {
  label: string;
  icon: IconName;
  value: number;
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
        value={draftValue}
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

function CategoryBars({
  data,
}: {
  data: {
    category: string;
    total: number;
    color: string;
  }[];
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

            <strong>{formatMoney(item.total)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function FlowChart({
  data,
}: {
  data: {
    month: string;
    income: number;
    expense: number;
    net: number;
    topCategory: string;
    topCategoryTotal: number;
  }[];
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
            <span>Gelir: {formatMoney(item.income)}</span>
            <span>Gider: {formatMoney(item.expense)}</span>
            <span>Net: {formatMoney(item.net)}</span>
            <span>
              Baskın gider: {item.topCategory}
              {item.topCategoryTotal > 0 ? ` / ${formatMoney(item.topCategoryTotal)}` : ""}
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
          <span>{formatMoney(total)}</span>
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
                    {formatMoney(item.total)} · %{percent.toFixed(1)}
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
          {formatMoney(netFlow)}
        </text>
      </svg>

      <div className="legendGroups">
        {renderLegendGroup("Gelirler", "Gelir yok", incomeData, incomeTotal)}
        {renderLegendGroup("Giderler", "Gider yok", expenseData, expenseTotal)}
      </div>
    </div>
  );
}