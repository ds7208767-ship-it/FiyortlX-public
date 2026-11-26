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
  category: string;
  amount: number;
  note: string;
  createdAt: string;
  isConfirmed: boolean;
  source?: "manual" | "debtPayment";
  debtId?: string;
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
