"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

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



const STORAGE_KEY = "money-talks-app-v4";

const tabs: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Genel" },
  { id: "transaction", label: "İşlem" },
  { id: "history", label: "Geçmiş" },
  { id: "debts", label: "Ödemeler" },
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
  "SatÄ±ÅŸ": "#22c55e",
  "Ä°ade": "#22c55e",
  "Kredi KartÄ± Ã–demesi": "#22c55e",
  "DiÄŸer Gelir": "#22c55e",
};

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

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + offset;
  const shiftedYear = Math.floor(monthIndex / 12);
  const shiftedMonth = monthIndex - shiftedYear * 12 + 1;

  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
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
    savings: 0,
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
  const [analysisReferenceMonth] = useState(() => todayInputValue().slice(0, 7));
  const [analysisPeriod, setAnalysisPeriod] = useState("this-month");

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
            savings: Number(saved.baseBalances.savings ?? 0),
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
    const savings = baseBalances.savings;
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
    const totalAssets = totalSpendable + savings;

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
  }, [baseBalances, transactions]);

  const analysisTransactions = useMemo(() => {
    if (analysisPeriod === "all") return transactions;

    const currentMonth = analysisReferenceMonth;
    const currentYear = currentMonth.slice(0, 4);

    if (analysisPeriod === "this-month") {
      return transactions.filter((item) => item.date.slice(0, 7) === currentMonth);
    }

    if (analysisPeriod === "last-month") {
      const lastMonth = shiftMonth(currentMonth, -1);

      return transactions.filter((item) => item.date.slice(0, 7) === lastMonth);
    }

    if (analysisPeriod === "last-3-months" || analysisPeriod === "last-6-months") {
      const monthCount = analysisPeriod === "last-3-months" ? 3 : 6;
      const firstMonth = shiftMonth(currentMonth, -(monthCount - 1));

      return transactions.filter((item) => {
        const month = item.date.slice(0, 7);

        return month >= firstMonth && month <= currentMonth;
      });
    }

    if (analysisPeriod === "this-year") {
      return transactions.filter((item) => item.date.slice(0, 4) === currentYear);
    }

    return transactions.filter((item) => item.date.slice(0, 7) === analysisPeriod);
  }, [analysisPeriod, analysisReferenceMonth, transactions]);

  const transactionSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;

    for (const item of analysisTransactions) {
      if (item.type === "income") totalIncome += item.amount;
      if (item.type === "expense") totalExpense += item.amount;
    }

    return {
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
    };
  }, [analysisTransactions]);

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
      alert("Ödeme adı boş olamaz.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Ödeme tutarı 0'dan büyük olmalı.");
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
    const target = debts.find((item) => item.id === debtId);

    if (!target) return;

    if (target.paidTransactionId) {
      setTransactions((current) =>
        current.filter((item) => item.id !== target.paidTransactionId),
      );
    }

    setDebts((current) => current.filter((item) => item.id !== debtId));
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="hero">
          <div className="brand">
            <div className="logoLine">
              <div className="logo">
                <Image
                  className="logoImage"
                  src="/mt-logo-clean.png"
                  alt="Money Talks logosu"
                  width={60}
                  height={60}
                  priority
                />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Money Talks</h1>
            </div>
            <p className="subtitle">Kişisel para akışı, ödemeler ve birikim takibi.</p>
          </div>

          <div className="heroStats">
            <div className="miniStat">
              <span>Genel Harcanabilir</span>
              <strong>{formatMoney(balances.totalSpendable)}</strong>
            </div>
            <div className="miniStat">
              <span>Toplam Varlık</span>
              <strong>{formatMoney(balances.totalAssets)}</strong>
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
            <div className="grid cards balanceCards" key={loaded ? "loaded" : "loading"}>
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
              <EditableMoneyCard
                label="Birikim"
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
                        {item.source === "debtPayment" && <span className="pill">Ödeme</span>}
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
                label="Bekleyen Ödeme"
                value={formatMoney(debtSummary.unpaidTotal)}
              />
              <ReadonlyMoneyCard
                label="Tamamlanan Ödeme"
                value={formatMoney(debtSummary.paidTotal)}
              />
              <ReadonlyMoneyCard label="Açık Kayıt" value={String(debtSummary.unpaidCount)} />
              <ReadonlyMoneyCard label="Kart Borcu" value={formatMoney(balances.creditDebt)} />
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Ödeme / Taksit Ekle</h2>
                  <p>Ödeme yaparken hesabı seçebilirsin.</p>
                </div>
              </div>

              <form onSubmit={addDebt} className="sectionStack">
                <div className="formGrid">
                  <div className="field">
                    <label>Ödeme Adı</label>
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
                    Ödeme Ekle
                  </button>
                </div>
              </form>
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Ödemeler / Taksitler</h2>
                  <p>Ödendi yapınca geçmişe otomatik gider eklenir.</p>
                </div>
              </div>

              {sortedDebts.length === 0 ? (
                <Empty text="Henüz ödeme/taksit kaydı yok." />
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
              <ReadonlyMoneyCard label="İşlem Sayısı" value={String(analysisTransactions.length)} />
            </div>

            <div className="panel">
              <div className="sectionHeader">
                <div>
                  <h2>Analiz</h2>
                  <p>Bir görünüm seç.</p>
                </div>

                <div className="analysisPeriodField">
                  <label htmlFor="analysis-period">Dönem</label>
                  <select
                    id="analysis-period"
                    value={analysisPeriod}
                    onChange={(event) => setAnalysisPeriod(event.target.value)}
                  >
                    <option value="this-month">Bu Ay</option>
                    <option value="last-month">Geçen Ay</option>
                    <option value="last-3-months">Son 3 Ay</option>
                    <option value="last-6-months">Son 6 Ay</option>
                    <option value="this-year">Bu Yıl</option>
                    <option value="all">Tüm Zamanlar</option>
                  </select>
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
  const [draftValue, setDraftValue] = useState(() =>
    Number.isFinite(value) ? String(value) : "",
  );

  return (
    <div className="card editableMoneyCard">
      <div className="cardLabel">{label}</div>
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
              stroke="rgba(255,255,255,0.1)"
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
          stroke="rgba(255,255,255,0.22)"
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
                y={baseY - netHeight}
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
        aria-label={
          incomeCoversExpenses
            ? "Gelir giderlerin tamamını karşılıyor."
            : `Giderlerin yüzde ${(coverageRatio * 100).toFixed(1)} kadarı gelirle karşılanıyor.`
        }
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
          stroke="rgba(255,255,255,0.08)"
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

        <circle cx="120" cy="120" r="34" fill="rgba(16, 8, 31, 0.92)" />

        <text
          x="120"
          y="108"
          textAnchor="middle"
          fill="rgba(255,255,255,0.75)"
          fontSize="12"
          fontWeight="800"
        >
          Net Akış
        </text>
        <text
          x="120"
          y="132"
          textAnchor="middle"
          fill="white"
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
