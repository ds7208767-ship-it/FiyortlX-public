"use client";

import { useEffect, useMemo, useState } from "react";

type TabKey = "overview" | "transaction" | "history" | "debts" | "analysis";
type TransactionType = "income" | "expense";
type AccountKey = "cash" | "bank" | "creditCard" | "benefit";
type AnalysisMode = "category" | "flow" | "pie";

type BaseBalances = {
  cash: number;
  bank: number;
  benefit: number;
  creditDebt: number;
};

type Transaction = {
  id: string;
  date: string;
  type: TransactionType;
  account: AccountKey;
  category: string;
  amount: number;
  note: string;
  createdAt: string;
  source?: "manual" | "debtPayment";
  debtId?: string;
};

type Debt = {
  id: string;
  title: string;
  amount: number;
  dueDate: string;
  note: string;
  paid: boolean;
  paidFrom?: AccountKey;
  paidAt?: string;
  paidTransactionId?: string;
  createdAt: string;
};

type PersistedState = {
  baseBalances: BaseBalances;
  transactions: Transaction[];
  debts: Debt[];
};

const STORAGE_KEY = "money-talks-app-v4";

const theme = {
  bg: "#12091f",
  panel: "#1e1230",
  panelSoft: "#28183f",
  panelLighter: "#35204f",
  text: "#f7f1ff",
  muted: "#bda9dc",
  primary: "#8b5cf6",
  primaryDark: "#6d28d9",
  danger: "#dc2626",
  dangerDark: "#7f1d1d",
  success: "#22c55e",
  border: "rgba(255,255,255,0.12)",
};

const tabs: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Genel" },
  { id: "transaction", label: "İşlem" },
  { id: "history", label: "Geçmiş" },
  { id: "debts", label: "Borçlar" },
  { id: "analysis", label: "Analiz" },
];

const accountLabels: Record<AccountKey, string> = {
  cash: "Nakit",
  bank: "Banka",
  creditCard: "Kredi Kartı",
  benefit: "Yan Hak",
};

const accountOptions: AccountKey[] = ["cash", "bank", "creditCard", "benefit"];

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
  "#8b5cf6",
  "#a855f7",
  "#c084fc",
  "#7c3aed",
  "#6d28d9",
  "#22c55e",
  "#ef4444",
  "#38bdf8",
  "#f472b6",
  "#14b8a6",
  "#f97316",
  "#e879f9",
];

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function createId(prefix = "id") {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseAmountInput(value: string) {
  const cleaned = value.trim().replace(/\s/g, "");

  if (!cleaned) return 0;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }

  return Number(cleaned.replace(",", "."));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
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

function sortByCreatedAscending(a: Transaction, b: Transaction) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function sortByDateNewest(a: Transaction, b: Transaction) {
  const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();

  if (dateDiff !== 0) return dateDiff;

  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loaded, setLoaded] = useState(false);

  const [baseBalances, setBaseBalances] = useState<BaseBalances>({
    cash: 0,
    bank: 0,
    benefit: 0,
    creditDebt: 0,
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);

  const [txType, setTxType] = useState<TransactionType>("expense");
  const [txAccount, setTxAccount] = useState<AccountKey>("bank");
  const [txCategory, setTxCategory] = useState(expenseCategories[0]);
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txDate, setTxDate] = useState(todayInputValue());

  const [debtTitle, setDebtTitle] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [debtDueDate, setDebtDueDate] = useState(todayInputValue());
  const [debtNote, setDebtNote] = useState("");
  const [paymentAccounts, setPaymentAccounts] = useState<Record<string, AccountKey>>({});
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("category");

  useEffect(() => {
    let cancelled = false;
    let savedBalances: BaseBalances | undefined;
    let savedTransactions: Transaction[] | undefined;
    let savedDebts: Debt[] | undefined;

    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem("money-talks-app-v3") ??
        localStorage.getItem("money-talks-app-v2") ??
        localStorage.getItem("money-talks-app-v1");

      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedState>;

        if (saved.baseBalances) {
          savedBalances = {
          cash: Number(saved.baseBalances.cash ?? 0),
          bank: Number(saved.baseBalances.bank ?? 0),
          benefit: Number(saved.baseBalances.benefit ?? 0),
          creditDebt: Number(saved.baseBalances.creditDebt ?? 0),
          };
        }

        if (Array.isArray(saved.transactions)) {
          savedTransactions = saved.transactions;
        }

        if (Array.isArray(saved.debts)) {
          savedDebts = saved.debts;
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }

    queueMicrotask(() => {
      if (cancelled) return;

      if (savedBalances) setBaseBalances(savedBalances);
      if (savedTransactions) setTransactions(savedTransactions);
      if (savedDebts) setDebts(savedDebts);
      setLoaded(true);

    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const data: PersistedState = {
      baseBalances,
      transactions,
      debts,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [baseBalances, transactions, debts, loaded]);

  function handleTransactionTypeChange(nextType: TransactionType) {
    const nextCategories = nextType === "income" ? incomeCategories : expenseCategories;

    setTxType(nextType);

    if (!nextCategories.includes(txCategory)) {
      setTxCategory(nextCategories[0]);
    }
  }

  const balances = useMemo(() => {
    let cash = baseBalances.cash;
    let bank = baseBalances.bank;
    let benefit = baseBalances.benefit;
    let creditDebt = baseBalances.creditDebt;

    const orderedTransactions = [...transactions].sort(sortByCreatedAscending);

    for (const item of orderedTransactions) {
      if (item.type === "expense") {
        if (item.account === "cash") cash -= item.amount;
        if (item.account === "bank") bank -= item.amount;
        if (item.account === "benefit") benefit -= item.amount;
        if (item.account === "creditCard") creditDebt += item.amount;
      }

      if (item.type === "income") {
        if (item.account === "cash") cash += item.amount;
        if (item.account === "bank") bank += item.amount;
        if (item.account === "benefit") benefit += item.amount;
        if (item.account === "creditCard") creditDebt = Math.max(0, creditDebt - item.amount);
      }
    }

    const mainMoney = cash + bank;
    const totalSpendable = cash + bank + benefit - creditDebt;

    return {
      cash,
      bank,
      benefit,
      creditDebt,
      mainMoney,
      totalSpendable,
    };
  }, [baseBalances, transactions]);

  const transactionSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;

    for (const item of transactions) {
      if (item.type === "income") totalIncome += item.amount;
      if (item.type === "expense") totalExpense += item.amount;
    }

    return {
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
    };
  }, [transactions]);

  const debtSummary = useMemo(() => {
    const unpaid = debts.filter((item) => !item.paid);
    const paid = debts.filter((item) => item.paid);

    return {
      unpaidTotal: unpaid.reduce((sum, item) => sum + item.amount, 0),
      paidTotal: paid.reduce((sum, item) => sum + item.amount, 0),
      unpaidCount: unpaid.length,
      paidCount: paid.length,
    };
  }, [debts]);

  const categoryData = useMemo(() => {
    const grouped: Record<string, number> = {};

    for (const item of transactions) {
      if (item.type !== "expense") continue;

      grouped[item.category] = (grouped[item.category] ?? 0) + item.amount;
    }

    return Object.entries(grouped)
      .map(([category, total], index) => ({
        category,
        total,
        color: chartColors[index % chartColors.length],
      }))
      .sort((a, b) => b.total - a.total);
  }, [transactions]);

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

    for (const item of transactions) {
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
  }, [transactions]);

  const sortedTransactions = useMemo(() => {
    return [...transactions].sort(sortByDateNewest);
  }, [transactions]);

  const sortedDebts = useMemo(() => {
    return [...debts].sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1;

      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [debts]);

  function updateBaseBalance(key: keyof BaseBalances, rawValue: string) {
    const parsed = parseAmountInput(rawValue);

    setBaseBalances((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  function addTransaction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = parseAmountInput(txAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Tutar 0'dan büyük olmalı.");
      return;
    }

    const newTransaction: Transaction = {
      id: createId("tx"),
      date: txDate || todayInputValue(),
      type: txType,
      account: txAccount,
      category: txCategory,
      amount,
      note: txNote.trim(),
      createdAt: new Date().toISOString(),
      source: "manual",
    };

    setTransactions((current) => [newTransaction, ...current]);

    setTxAmount("");
    setTxNote("");
    setTxDate(todayInputValue());
    setActiveTab("history");
  }

  function undoTransaction(transactionId: string) {
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
  }

  function addDebt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = parseAmountInput(debtAmount);

    if (!debtTitle.trim()) {
      alert("Borç adı boş olamaz.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Borç tutarı 0'dan büyük olmalı.");
      return;
    }

    const newDebt: Debt = {
      id: createId("debt"),
      title: debtTitle.trim(),
      amount,
      dueDate: debtDueDate || todayInputValue(),
      note: debtNote.trim(),
      paid: false,
      createdAt: new Date().toISOString(),
    };

    setDebts((current) => [newDebt, ...current]);

    setDebtTitle("");
    setDebtAmount("");
    setDebtDueDate(todayInputValue());
    setDebtNote("");
  }

  function payDebt(debtId: string) {
    const target = debts.find((item) => item.id === debtId);

    if (!target || target.paid) return;

    const paidFrom = paymentAccounts[debtId] ?? "bank";
    const transactionId = createId("tx");

    const paymentTransaction: Transaction = {
      id: transactionId,
      date: todayInputValue(),
      type: "expense",
      account: paidFrom,
      category: "Borç / Taksit Ödemesi",
      amount: target.amount,
      note: target.note
        ? `${target.title} ödendi. Not: ${target.note}`
        : `${target.title} ödendi.`,
      createdAt: new Date().toISOString(),
      source: "debtPayment",
      debtId: target.id,
    };

    setTransactions((current) => [paymentTransaction, ...current]);

    setDebts((current) =>
      current.map((debt) => {
        if (debt.id !== debtId) return debt;

        return {
          ...debt,
          paid: true,
          paidFrom,
          paidAt: todayInputValue(),
          paidTransactionId: transactionId,
        };
      }),
    );
  }

  function undoDebtPayment(debtId: string) {
    const target = debts.find((item) => item.id === debtId);

    if (!target) return;

    if (target.paidTransactionId) {
      setTransactions((current) =>
        current.filter((item) => item.id !== target.paidTransactionId),
      );
    }

    setDebts((current) =>
      current.map((debt) => {
        if (debt.id !== debtId) return debt;

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

  function deleteDebt(debtId: string) {
    setDebts((current) => current.filter((item) => item.id !== debtId));
  }

  return (
    <main className="page">
      <style>{`
        :root {
          --bg: ${theme.bg};
          --panel: ${theme.panel};
          --panel-soft: ${theme.panelSoft};
          --panel-lighter: ${theme.panelLighter};
          --text: ${theme.text};
          --muted: ${theme.muted};
          --primary: ${theme.primary};
          --primary-dark: ${theme.primaryDark};
          --danger: ${theme.danger};
          --danger-dark: ${theme.dangerDark};
          --success: ${theme.success};
          --border: ${theme.border};
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(139, 92, 246, 0.28), transparent 34rem),
            radial-gradient(circle at bottom right, rgba(168, 85, 247, 0.18), transparent 30rem),
            var(--bg);
          color: var(--text);
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        button,
        input,
        select,
        textarea {
          font: inherit;
        }

        button {
          cursor: pointer;
        }

        .page {
          min-height: 100vh;
          padding: 28px;
        }

        .shell {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .hero {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          padding: 24px;
          border: 1px solid var(--border);
          border-radius: 28px;
          background:
            linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(30, 18, 48, 0.9)),
            var(--panel);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }

        .brand {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .logoLine {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo {
          display: grid;
          place-items: center;
          width: 46px;
          height: 46px;
          border-radius: 16px;
          background: linear-gradient(135deg, var(--primary), #d8b4fe);
          color: white;
          font-size: 24px;
          font-weight: 900;
          box-shadow: 0 16px 36px rgba(139, 92, 246, 0.32);
        }

        h1,
        h2,
        h3,
        p {
          margin: 0;
        }

        h1 {
          font-size: clamp(32px, 4vw, 54px);
          line-height: 1;
          letter-spacing: -0.06em;
        }

        .subtitle {
          color: var(--muted);
          max-width: 660px;
          line-height: 1.6;
        }

        .heroStats {
          display: grid;
          gap: 10px;
          min-width: 250px;
        }

        .miniStat {
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.06);
        }

        .miniStat span {
          display: block;
          color: var(--muted);
          font-size: 13px;
          margin-bottom: 4px;
        }

        .miniStat strong {
          font-size: 22px;
        }

        .tabs {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: 20px 0;
          padding: 8px;
          border: 1px solid var(--border);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.04);
        }

        .tab {
          border: 0;
          color: var(--muted);
          background: transparent;
          padding: 12px 16px;
          border-radius: 16px;
          transition: 0.18s ease;
          font-weight: 800;
        }

        .tab:hover {
          color: var(--text);
          background: rgba(255, 255, 255, 0.06);
        }

        .tab.active {
          color: white;
          background: linear-gradient(135deg, var(--primary), var(--primary-dark));
          box-shadow: 0 12px 24px rgba(139, 92, 246, 0.24);
        }

        .grid {
          display: grid;
          gap: 16px;
        }

        .grid.cards {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .grid.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .panel,
        .card {
          border: 1px solid var(--border);
          border-radius: 24px;
          background: rgba(30, 18, 48, 0.86);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
        }

        .panel {
          padding: 20px;
        }

        .card {
          padding: 18px;
        }

        .cardLabel {
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .cardValue {
          margin-top: 10px;
          font-size: 30px;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .editableMoneyCard {
          display: grid;
          gap: 12px;
        }

        .moneyInput {
          width: 100%;
          border: 0;
          border-bottom: 1px solid rgba(255,255,255,0.16);
          border-radius: 0;
          background: transparent;
          color: var(--text);
          outline: none;
          padding: 8px 0;
          font-size: 30px;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .moneyInput:focus {
          border-color: rgba(196, 181, 253, 0.9);
          box-shadow: none;
        }

        .readonlyTotal {
          min-height: 55px;
          display: flex;
          align-items: center;
        }

        .sectionStack {
          display: grid;
          gap: 16px;
        }

        .sectionHeader {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
          margin-bottom: 16px;
        }

        .sectionHeader p {
          color: var(--muted);
          margin-top: 6px;
          line-height: 1.5;
        }

        .formGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .field {
          display: grid;
          gap: 8px;
        }

        .field.full {
          grid-column: 1 / -1;
        }

        label {
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
        }

        input,
        select,
        textarea {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.06);
          color: var(--text);
          outline: none;
          padding: 13px 14px;
        }

        textarea {
          min-height: 90px;
          resize: vertical;
        }

        input:focus,
        select:focus,
        textarea:focus {
          border-color: rgba(196, 181, 253, 0.8);
          box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.16);
        }

        select option {
          background: #1e1230;
          color: white;
        }

        .buttonRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 16px;
        }

        .btn {
          border: 0;
          border-radius: 16px;
          padding: 12px 16px;
          color: white;
          font-weight: 900;
          background: linear-gradient(135deg, var(--primary), var(--primary-dark));
          box-shadow: 0 14px 26px rgba(139, 92, 246, 0.25);
        }

        .btn.secondary {
          color: var(--text);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: none;
          border: 1px solid var(--border);
        }

        .btn.danger {
          background: linear-gradient(135deg, #ef4444, #991b1b);
          box-shadow: 0 14px 26px rgba(220, 38, 38, 0.28);
        }

        .btn.success {
          background: linear-gradient(135deg, var(--success), #15803d);
          box-shadow: 0 14px 26px rgba(34, 197, 94, 0.22);
        }

        .btn.small {
          padding: 9px 12px;
          border-radius: 13px;
          font-size: 13px;
        }

        .list {
          display: grid;
          gap: 12px;
        }

        .listItem {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.045);
        }

        .listTitle {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-weight: 950;
        }

        .meta {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          color: var(--muted);
          font-size: 13px;
          margin-top: 6px;
        }

        .note {
          color: var(--muted);
          margin-top: 8px;
          line-height: 1.45;
        }

        .amount {
          font-size: 22px;
          font-weight: 950;
          text-align: right;
        }

        .amount.income {
          color: var(--success);
        }

        .amount.expense {
          color: #fca5a5;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          background: rgba(255, 255, 255, 0.08);
          color: var(--muted);
          border: 1px solid var(--border);
        }

        .pill.income {
          color: #bbf7d0;
          border-color: rgba(34, 197, 94, 0.28);
          background: rgba(34, 197, 94, 0.1);
        }

        .pill.expense {
          color: #fecaca;
          border-color: rgba(239, 68, 68, 0.28);
          background: rgba(239, 68, 68, 0.1);
        }

        .pill.paid {
          color: #bbf7d0;
          border-color: rgba(34, 197, 94, 0.28);
          background: rgba(34, 197, 94, 0.1);
        }

        .pill.unpaid {
          color: #fecaca;
          border-color: rgba(239, 68, 68, 0.32);
          background: rgba(239, 68, 68, 0.1);
        }

        .empty {
          text-align: center;
          padding: 38px 20px;
          color: var(--muted);
          border: 1px dashed var(--border);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.035);
        }

        .analysisPicker {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 18px;
        }

        .analysisChoice {
          min-height: 220px;
          border: 1px solid var(--border);
          border-radius: 24px;
          padding: 18px;
          color: var(--text);
          background:
            radial-gradient(circle at top, rgba(139, 92, 246, 0.18), transparent 12rem),
            rgba(255, 255, 255, 0.045);
          text-align: left;
          transition: 0.18s ease;
        }

        .analysisChoice:hover {
          transform: translateY(-2px);
          border-color: rgba(196, 181, 253, 0.55);
          background:
            radial-gradient(circle at top, rgba(139, 92, 246, 0.24), transparent 12rem),
            rgba(255, 255, 255, 0.07);
        }

        .analysisChoice.active {
          border-color: rgba(196, 181, 253, 0.95);
          box-shadow:
            0 0 0 4px rgba(139, 92, 246, 0.16),
            0 20px 46px rgba(139, 92, 246, 0.18);
        }

        .analysisChoice h3 {
          font-size: 22px;
          margin-bottom: 6px;
        }

        .analysisChoice p {
          color: var(--muted);
          line-height: 1.45;
          margin-bottom: 18px;
        }

        .previewBars {
          display: grid;
          gap: 10px;
          margin-top: 20px;
        }

        .previewBar {
          height: 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .previewFill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #8b5cf6, #c084fc);
        }

        .previewFlow {
          height: 96px;
          display: flex;
          align-items: end;
          justify-content: center;
          gap: 14px;
          margin-top: 16px;
        }

        .previewColumn {
          width: 28px;
          border-radius: 999px 999px 8px 8px;
          background: linear-gradient(180deg, #c084fc, #7c3aed);
        }

        .previewPie {
          width: 100px;
          height: 100px;
          border-radius: 999px;
          margin: 16px auto 0;
          background:
            conic-gradient(
              #8b5cf6 0 34%,
              #22c55e 34% 52%,
              #ef4444 52% 71%,
              #38bdf8 71% 86%,
              #c084fc 86% 100%
            );
          position: relative;
        }

        .previewPie::after {
          content: "";
          position: absolute;
          inset: 24px;
          border-radius: 999px;
          background: #1e1230;
        }

        .analysisCanvas {
          min-height: 460px;
          display: grid;
          place-items: center;
          padding: 20px;
          border: 1px solid var(--border);
          border-radius: 28px;
          background:
            radial-gradient(circle at center top, rgba(139, 92, 246, 0.16), transparent 22rem),
            rgba(255, 255, 255, 0.035);
        }

        .analysisInner {
          width: min(940px, 100%);
          margin: 0 auto;
        }

        .bars {
          display: grid;
          gap: 15px;
          width: 100%;
        }

        .barLine {
          display: grid;
          grid-template-columns: 190px 1fr 120px;
          gap: 14px;
          align-items: center;
        }

        .barTrack {
          height: 18px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .barFill {
          height: 100%;
          border-radius: 999px;
        }

        .chartBox {
          width: 100%;
          overflow-x: auto;
          padding: 8px 0;
        }

        .flowSvg {
          display: block;
          margin: 0 auto;
        }

        .flowCards {
          margin-top: 18px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .flowCard {
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.045);
        }

        .flowCard strong {
          display: block;
          margin-bottom: 8px;
        }

        .flowCard span {
          display: block;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.6;
        }

        .pieWrap {
          width: 100%;
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: 34px;
          align-items: center;
          justify-content: center;
        }

        .pieSvg {
          width: 320px;
          height: 320px;
          display: block;
          margin: 0 auto;
        }

        .legend {
          display: grid;
          gap: 12px;
        }

        .legendItem {
          display: grid;
          grid-template-columns: 14px 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .legendColor {
          width: 14px;
          height: 14px;
          border-radius: 999px;
        }

        .debtActions {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .paymentSelect {
          width: 155px;
          padding: 9px 10px;
          border-radius: 13px;
        }

        @media (max-width: 980px) {
          .hero {
            display: grid;
          }

          .heroStats,
          .grid.cards,
          .grid.two,
          .formGrid,
          .analysisPicker,
          .pieWrap,
          .flowCards {
            grid-template-columns: 1fr;
          }

          .barLine {
            grid-template-columns: 1fr;
          }

          .listItem {
            grid-template-columns: 1fr;
          }

          .amount {
            text-align: left;
          }

          .debtActions {
            justify-content: flex-start;
          }

          .paymentSelect {
            width: 100%;
          }

          .pieSvg {
            width: 260px;
            height: 260px;
          }
        }

        @media (max-width: 560px) {
          .page {
            padding: 16px;
          }

          .hero,
          .panel,
          .card {
            border-radius: 20px;
          }

          .sectionHeader {
            display: grid;
          }

          .tabs {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .tab {
            width: 100%;
          }

          .analysisCanvas {
            padding: 14px;
          }
        }
      `}</style>

      <div className="shell">
        <header className="hero">
          <div className="brand">
            <div className="logoLine">
              <div className="logo">₺</div>
              <h1>Money Talks</h1>
            </div>
            <p className="subtitle">Kişisel para akışı, borçlar ve harcama analizi.</p>
          </div>

          <div className="heroStats">
            <div className="miniStat">
              <span>Genel Harcanabilir</span>
              <strong>{formatMoney(balances.totalSpendable)}</strong>
            </div>
            <div className="miniStat">
              <span>Net Akış</span>
              <strong>{formatMoney(transactionSummary.netFlow)}</strong>
            </div>
          </div>
        </header>

        <nav className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <section className="sectionStack">
            <div className="grid cards">
              <EditableMoneyCard
                label="Nakit"
                value={baseBalances.cash}
                onChange={(value) => updateBaseBalance("cash", value)}
              />
              <EditableMoneyCard
                label="Banka"
                value={baseBalances.bank}
                onChange={(value) => updateBaseBalance("bank", value)}
              />
              <EditableMoneyCard
                label="Kredi Kartı Borcu"
                value={baseBalances.creditDebt}
                onChange={(value) => updateBaseBalance("creditDebt", value)}
              />
              <EditableMoneyCard
                label="Yan Hak"
                value={baseBalances.benefit}
                onChange={(value) => updateBaseBalance("benefit", value)}
              />
            </div>

            <div className="grid two">
              <ReadonlyMoneyCard label="Ana Para" value={formatMoney(balances.mainMoney)} />
              <ReadonlyMoneyCard
                label="Genel Harcanabilir"
                value={formatMoney(balances.totalSpendable)}
              />
            </div>
          </section>
        )}

        {activeTab === "transaction" && (
          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>İşlem Ekle</h2>
                <p>Gelir veya gider gir.</p>
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
                  </select>
                </div>

                <div className="field">
                  <label>Hesap</label>
                  <select
                    value={txAccount}
                    onChange={(event) => setTxAccount(event.target.value as AccountKey)}
                  >
                    {accountOptions.map((account) => (
                      <option key={account} value={account}>
                        {accountLabels[account]}
                      </option>
                    ))}
                  </select>
                </div>

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
                    onChange={(event) => setTxDate(event.target.value)}
                  />
                </div>

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
                  İşlemi Ekle
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setTxAmount("");
                    setTxNote("");
                    setTxDate(todayInputValue());
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

            {sortedTransactions.length === 0 ? (
              <Empty text="Henüz işlem yok." />
            ) : (
              <div className="list">
                {sortedTransactions.map((item) => (
                  <div className="listItem" key={item.id}>
                    <div>
                      <div className="listTitle">
                        <span className={`pill ${item.type}`}>
                          {item.type === "income" ? "Gelir" : "Gider"}
                        </span>
                        <span>{item.category}</span>
                        {item.source === "debtPayment" && <span className="pill">Borç</span>}
                      </div>

                      <div className="meta">
                        <span>{formatDate(item.date)}</span>
                        <span>{accountLabels[item.account]}</span>
                      </div>

                      {item.note && <p className="note">{item.note}</p>}
                    </div>

                    <div>
                      <div className={`amount ${item.type}`}>
                        {item.type === "income" ? "+" : "-"}
                        {formatMoney(item.amount)}
                      </div>

                      <div className="buttonRow" style={{ justifyContent: "flex-end" }}>
                        <button
                          className="btn danger small"
                          type="button"
                          onClick={() => undoTransaction(item.id)}
                        >
                          Geri Al
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "debts" && (
          <section className="sectionStack">
            <div className="grid cards">
              <ReadonlyMoneyCard
                label="Ödenmemiş Borç"
                value={formatMoney(debtSummary.unpaidTotal)}
              />
              <ReadonlyMoneyCard label="Ödenen Borç" value={formatMoney(debtSummary.paidTotal)} />
              <ReadonlyMoneyCard label="Açık Kayıt" value={String(debtSummary.unpaidCount)} />
              <ReadonlyMoneyCard label="Kart Borcu" value={formatMoney(balances.creditDebt)} />
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Borç / Taksit Ekle</h2>
                  <p>Ödeme yaparken hesabı seçebilirsin.</p>
                </div>
              </div>

              <form onSubmit={addDebt} className="sectionStack">
                <div className="formGrid">
                  <div className="field">
                    <label>Borç Adı</label>
                    <input
                      value={debtTitle}
                      onChange={(event) => setDebtTitle(event.target.value)}
                      placeholder="Örn: Araç sigortası"
                    />
                  </div>

                  <div className="field">
                    <label>Tutar</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={debtAmount}
                      onChange={(event) => setDebtAmount(event.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="field">
                    <label>Tarih</label>
                    <input
                      type="date"
                      value={debtDueDate}
                      onChange={(event) => setDebtDueDate(event.target.value)}
                    />
                  </div>

                  <div className="field full">
                    <label>Not</label>
                    <textarea
                      value={debtNote}
                      onChange={(event) => setDebtNote(event.target.value)}
                      placeholder="İsteğe bağlı not..."
                    />
                  </div>
                </div>

                <div className="buttonRow">
                  <button className="btn" type="submit">
                    Borç Ekle
                  </button>
                </div>
              </form>
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Borçlar / Taksitler</h2>
                  <p>Ödendi yapınca geçmişe otomatik gider eklenir.</p>
                </div>
              </div>

              {sortedDebts.length === 0 ? (
                <Empty text="Henüz borç/taksit kaydı yok." />
              ) : (
                <div className="list">
                  {sortedDebts.map((debt) => (
                    <div className="listItem" key={debt.id}>
                      <div>
                        <div className="listTitle">
                          <span className={`pill ${debt.paid ? "paid" : "unpaid"}`}>
                            {debt.paid ? "Ödendi" : "Ödenmedi"}
                          </span>
                          <span>{debt.title}</span>
                        </div>

                        <div className="meta">
                          <span>{formatDate(debt.dueDate)}</span>
                          <span>{formatMoney(debt.amount)}</span>
                          {debt.paidFrom && <span>{accountLabels[debt.paidFrom]}</span>}
                          {debt.paidAt && <span>{formatDate(debt.paidAt)}</span>}
                        </div>

                        {debt.note && <p className="note">{debt.note}</p>}
                      </div>

                      <div className="debtActions">
                        {!debt.paid && (
                          <select
                            className="paymentSelect"
                            value={paymentAccounts[debt.id] ?? "bank"}
                            onChange={(event) =>
                              setPaymentAccounts((current) => ({
                                ...current,
                                [debt.id]: event.target.value as AccountKey,
                              }))
                            }
                          >
                            {accountOptions.map((account) => (
                              <option key={account} value={account}>
                                {accountLabels[account]}
                              </option>
                            ))}
                          </select>
                        )}

                        {debt.paid ? (
                          <button
                            className="btn danger small"
                            type="button"
                            onClick={() => undoDebtPayment(debt.id)}
                          >
                            Geri Al
                          </button>
                        ) : (
                          <button
                            className="btn success small"
                            type="button"
                            onClick={() => payDebt(debt.id)}
                          >
                            Ödendi Yap
                          </button>
                        )}

                        <button
                          className="btn danger small"
                          type="button"
                          onClick={() => deleteDebt(debt.id)}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "analysis" && (
          <section className="sectionStack">
            <div className="grid cards">
              <ReadonlyMoneyCard label="Toplam Gelir" value={formatMoney(transactionSummary.totalIncome)} />
              <ReadonlyMoneyCard label="Toplam Gider" value={formatMoney(transactionSummary.totalExpense)} />
              <ReadonlyMoneyCard label="Net Akış" value={formatMoney(transactionSummary.netFlow)} />
              <ReadonlyMoneyCard label="İşlem Sayısı" value={String(transactions.length)} />
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Analiz</h2>
                  <p>Bir görünüm seç.</p>
                </div>
              </div>

              <div className="analysisPicker">
                <button
                  className={`analysisChoice ${analysisMode === "category" ? "active" : ""}`}
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
                  className={`analysisChoice ${analysisMode === "flow" ? "active" : ""}`}
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
                  className={`analysisChoice ${analysisMode === "pie" ? "active" : ""}`}
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
                  {transactions.length === 0 ? (
                    <Empty text="Grafik için önce birkaç işlem ekle." />
                  ) : (
                    <>
                      {analysisMode === "category" && <CategoryBars data={categoryData} />}
                      {analysisMode === "flow" && <FlowChart data={monthlyFlowData} />}
                      {analysisMode === "pie" && <PieChart data={categoryData} />}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function EditableMoneyCard({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="card editableMoneyCard">
      <div className="cardLabel">{label}</div>
      <input
        className="moneyInput"
        type="number"
        inputMode="decimal"
        step="0.01"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ReadonlyMoneyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="cardLabel">{label}</div>
      <div className="cardValue readonlyTotal">{value}</div>
    </div>
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

  const maxAbs = Math.max(...data.map((item) => Math.max(item.income, item.expense, Math.abs(item.net))), 1);
  const chartHeight = 240;
  const baseY = 190;
  const barMaxHeight = 145;
  const groupWidth = 86;
  const gap = 34;
  const width = Math.max(620, data.length * (groupWidth + gap) + 80);

  return (
    <div className="chartBox">
      <svg
        className="flowSvg"
        width={width}
        height={chartHeight + 70}
        viewBox={`0 0 ${width} ${chartHeight + 70}`}
        role="img"
      >
        <line
          x1="24"
          x2={width - 24}
          y1={baseY}
          y2={baseY}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1"
        />

        {data.map((item, index) => {
          const x = 44 + index * (groupWidth + gap);
          const incomeHeight = (item.income / maxAbs) * barMaxHeight;
          const expenseHeight = (item.expense / maxAbs) * barMaxHeight;
          const netHeight = (Math.abs(item.net) / maxAbs) * barMaxHeight;

          return (
            <g key={item.month}>
              <rect
                x={x}
                y={baseY - incomeHeight}
                width="22"
                height={incomeHeight}
                rx="8"
                fill="#22c55e"
              />

              <rect
                x={x + 30}
                y={baseY - expenseHeight}
                width="22"
                height={expenseHeight}
                rx="8"
                fill="#ef4444"
              />

              <rect
                x={x + 60}
                y={item.net >= 0 ? baseY - netHeight : baseY}
                width="22"
                height={netHeight}
                rx="8"
                fill={item.net >= 0 ? "#8b5cf6" : "#dc2626"}
              />

              <text
                x={x + 41}
                y={chartHeight + 4}
                textAnchor="middle"
                fill="rgba(255,255,255,0.72)"
                fontSize="12"
                fontWeight="800"
              >
                {formatMonth(item.month)}
              </text>

              <text
                x={x + 41}
                y={chartHeight + 24}
                textAnchor="middle"
                fill="rgba(255,255,255,0.9)"
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
          <div className="flowCard" key={item.month}>
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
  data,
}: {
  data: {
    category: string;
    total: number;
    color: string;
  }[];
}) {
  const total = data.reduce((sum, item) => sum + item.total, 0);

  if (data.length === 0 || total <= 0) {
    return <Empty text="Pasta grafiği için gider kategorisi bulunamadı." />;
  }

  const radius = 82;
  const circumference = 2 * Math.PI * radius;
  const segments = data.map((item, index) => {
    const dash = (item.total / total) * circumference;
    const previousTotal = data
      .slice(0, index)
      .reduce((sum, previousItem) => sum + previousItem.total, 0);

    return {
      ...item,
      dash,
      strokeDashoffset: -((previousTotal / total) * circumference),
    };
  });

  return (
    <div className="pieWrap">
      <svg className="pieSvg" viewBox="0 0 240 240" role="img">
        <circle
          cx="120"
          cy="120"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="38"
        />

        {segments.map((item) => {
          return (
            <circle
              key={item.category}
              cx="120"
              cy="120"
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth="38"
              strokeDasharray={`${item.dash} ${circumference - item.dash}`}
              strokeDashoffset={item.strokeDashoffset}
              transform="rotate(-90 120 120)"
            />
          );
        })}

        <text
          x="120"
          y="114"
          textAnchor="middle"
          fill="rgba(255,255,255,0.75)"
          fontSize="13"
          fontWeight="800"
        >
          Toplam
        </text>
        <text
          x="120"
          y="140"
          textAnchor="middle"
          fill="white"
          fontSize="19"
          fontWeight="950"
        >
          {formatMoney(total)}
        </text>
      </svg>

      <div className="legend">
        {data.map((item) => {
          const percent = (item.total / total) * 100;

          return (
            <div className="legendItem" key={item.category}>
              <span className="legendColor" style={{ background: item.color }} />
              <strong>{item.category}</strong>
              <span>
                {formatMoney(item.total)} · %{percent.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
