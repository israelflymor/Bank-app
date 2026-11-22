import type { Timestamp } from 'firebase/firestore';
import type { BankAccount, CurrencyCode, LedgerTransaction, TxType } from '../types/banking';

const CURRENCY_LOCALES: Record<CurrencyCode, string> = {
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
};

export function formatCents(cents: number, currency: CurrencyCode = 'USD'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatSignedCents(
  cents: number,
  direction: 'credit' | 'debit',
  currency: CurrencyCode = 'USD'
): string {
  const formatted = formatCents(Math.abs(cents), currency);
  return direction === 'credit' ? `+${formatted}` : `-${formatted}`;
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[,$\s]/g, '').trim();
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 100);
}

export function timestampToMs(ts: Timestamp | Date | number | null | undefined): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return 0;
}

export function formatDateShort(ts: Timestamp | Date | number | null | undefined): string {
  const ms = timestampToMs(ts);
  if (!ms) return 'Just now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

export function formatDateTime(ts: Timestamp | Date | number | null | undefined): string {
  const ms = timestampToMs(ts);
  if (!ms) return 'Just now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function toLocalDateKey(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalDateStringOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return toLocalDateKey(d);
}

export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `•••• ${accountNumber.slice(-4)}`;
}

export function generateShortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
}

export function generateReferenceCode(prefix = 'KST'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export function generateAccountNumber(): string {
  let digits = '48';
  for (let i = 0; i < 8; i++) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  return digits;
}

export function generateRoutineNumber(): string {
  let digits = '08';
  for (let i = 0; i < 9; i++) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  return digits;
}

export function generateIban(accountNumber: string, routingNumber = '021000021'): string {
  const routingSegment = routingNumber.replace(/[^0-9]/g, '').slice(-9).padStart(9, '0');
  return `US82KSTL${routingSegment}${accountNumber}`;
}

export function formatIsoDateToDDMMYYYY(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function isValidDDMMYYYY(input: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const normalized = input.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatTxTypeLabel(txType: TxType): string {
  switch (txType) {
    case 'deposit':
      return 'Direct Deposit';
    case 'payment_received':
      return 'Payment Received';
    case 'wire_in':
      return 'Inbound Wire';
    case 'transfer_out':
      return 'Outgoing Transfer';
    case 'internal_transfer':
      return 'Internal Transfer';
    case 'bill_pay':
      return 'Bill Payment';
    case 'card_spend':
      return 'Card Purchase';
    case 'p2p_transfer':
      return 'Peer Transfer';
    case 'admin_top_up':
      return 'Admin Top-Up';
    default:
      return txType;
  }
}

export function advanceDateString(dateStr: string, cadence: 'once' | 'weekly' | 'monthly'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (cadence === 'weekly') {
    dt.setUTCDate(dt.getUTCDate() + 7);
  } else if (cadence === 'monthly') {
    dt.setUTCMonth(dt.getUTCMonth() + 1);
  }
  return dt.toISOString().slice(0, 10);
}

export function exportTransactionsCsv(
  transactions: LedgerTransaction[],
  accounts: BankAccount[]
): void {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const headers = [
    'Date',
    'Reference',
    'Account',
    'Counterparty',
    'Type',
    'Category',
    'Direction',
    'Amount',
    'Currency',
    'Status',
    'Memo',
  ];

  const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const rows = transactions.map((tx) => [
    escapeCsv(formatDateTime(tx.createdAt)),
    escapeCsv(tx.referenceCode),
    escapeCsv(accountMap.get(tx.accountId) ?? tx.accountId),
    escapeCsv(tx.counterpartyName),
    escapeCsv(formatTxTypeLabel(tx.txType)),
    escapeCsv(tx.category),
    escapeCsv(tx.direction),
    (tx.direction === 'credit' ? tx.amountCents / 100 : -tx.amountCents / 100).toFixed(2),
    tx.currency,
    tx.status,
    escapeCsv(tx.memo),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kestrel-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
