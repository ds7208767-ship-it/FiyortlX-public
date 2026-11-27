export type TabKey = "overview" | "transaction" | "history" | "analysis";

export type TransactionType = "income" | "expense" | "transfer";

export type AccountKey = "cash" | "bank" | "creditCard" | "benefit" | "savings";

export type AnalysisMode = "category" | "flow" | "pie";

export type BaseBalances = {
  cash: number;
  bank: number;
  benefit: number;
  savings: number;
  creditDebt: number;
};

export type Transaction = {
  id: string;
  date: string;
  type: TransactionType;
  account: AccountKey;
  toAccount?: AccountKey;
  fixedIncomeId?: string;
  generatedMonth?: string;
  category: string;
  amount: number;
  note: string;
  createdAt: string;
  isConfirmed: boolean;
  isSystemXL?: boolean;
  source?: "manual" | "debtPayment";
  debtId?: string;
};

export type FixedIncome = {
  id: string;
  type: "income" | "expense";
  title: string;
  amount: number;
  account: AccountKey;
  dayOfMonth: number;
  lastGeneratedMonth: string | null;
  createdAt: string;
};

export type UserProfile = {
  avatarUrl: string | null;
  plan: "L" | "XL";
  planSource: "trial" | "google_play" | "manual";
  planExpiresAt: string | null;
};

export type Debt = {
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

export type PersistedState = {
  baseBalances: BaseBalances;
  transactions: Transaction[];
  debts: Debt[];
};
