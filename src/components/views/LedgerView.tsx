import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Search, XCircle } from 'lucide-react';
import {
  exportTransactionsCsv,
  formatCents,
  formatDateTime,
  formatSignedCents,
  formatTxTypeLabel,
} from '../../lib/format';
import {
  WITHDRAWAL_FROZEN_MESSAGE,
  isWithdrawalAccessFrozen,
  type BankAccount,
  type LedgerTransaction,
  type UserProfile,
} from '../../types/banking';
import { cancelPendingTransaction, settlePendingTransaction } from '../../services/bankingService';
import { Modal } from '../ui/Modal';
import { SegmentedTabs } from '../ui/SegmentedTabs';

interface LedgerViewProps {
  userId: string;
  profile: UserProfile | null;
  accounts: BankAccount[];
  transactions: LedgerTransaction[];
  preselectedAccountId?: string | null;
  preselectedTxId?: string | null;
  onClearPreselection?: () => void;
  onWithdrawalBlocked: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  userId,
  profile,
  accounts,
  transactions,
  preselectedAccountId,
  preselectedTxId,
  onClearPreselection,
  onWithdrawalBlocked,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'settled' | 'pending' | 'cancelled'>('all');
  const [selectedTx, setSelectedTx] = useState<LedgerTransaction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!preselectedAccountId && !preselectedTxId) return;
    if (preselectedAccountId) {
      setAccountFilter(preselectedAccountId);
    }
    if (preselectedTxId) {
      const match = transactions.find((t) => t.id === preselectedTxId);
      if (match) setSelectedTx(match);
    }
    onClearPreselection?.();
  }, [preselectedAccountId, preselectedTxId, transactions, onClearPreselection]);

  const liveSelectedTx = useMemo(
    () => (selectedTx ? transactions.find((t) => t.id === selectedTx.id) ?? selectedTx : null),
    [selectedTx, transactions]
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (accountFilter !== 'all' && tx.accountId !== accountFilter) return false;
      if (directionFilter !== 'all' && tx.direction !== directionFilter) return false;
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (!q) return true;
      return (
        tx.counterpartyName.toLowerCase().includes(q) ||
        tx.referenceCode.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        tx.memo.toLowerCase().includes(q)
      );
    });
  }, [transactions, searchQuery, accountFilter, directionFilter, statusFilter]);

  const handleSettle = async (tx: LedgerTransaction) => {
    const isFrozenBlockedDebit =
      tx.direction === 'debit' &&
      (tx.txType === 'transfer_out' ||
        tx.txType === 'bill_pay' ||
        tx.txType === 'card_spend' ||
        tx.txType === 'p2p_transfer');

    if (isFrozenBlockedDebit && isWithdrawalAccessFrozen(profile)) {
      setSelectedTx(null);
      onWithdrawalBlocked();
      return;
    }

    setBusyId(tx.id);
    try {
      await settlePendingTransaction(userId, tx.id);
      setSelectedTx(null);
      onNotify('success', `Transaction ${tx.referenceCode} settled.`);
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        setSelectedTx(null);
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Unable to settle transaction.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (tx: LedgerTransaction) => {
    setBusyId(tx.id);
    try {
      await cancelPendingTransaction(tx.id);
      setSelectedTx(null);
      onNotify('success', `Pending transaction ${tx.referenceCode} cancelled.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel transaction.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search counterparty, reference, memo..."
              aria-label="Search transactions"
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-700"
            />
          </div>

          <select
            aria-label="Filter by account"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-blue-700"
          >
            <option value="all">All Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>

          <SegmentedTabs
            layoutId="ledgerDirectionTab"
            size="sm"
            value={directionFilter}
            onChange={setDirectionFilter}
            options={[
              { id: 'all', label: 'All' },
              { id: 'credit', label: 'Credits (In)' },
              { id: 'debit', label: 'Debits (Out)' },
            ]}
          />

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'settled' | 'pending' | 'cancelled')
            }
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-blue-700"
          >
            <option value="all">All Statuses</option>
            <option value="settled">Settled</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => exportTransactionsCsv(filteredTransactions, accounts)}
          disabled={filteredTransactions.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No transactions match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-6">Counterparty &amp; Memo</th>
                  <th className="py-2.5 px-4">Account</th>
                  <th className="py-2.5 px-4">Method / Category</th>
                  <th className="py-2.5 px-4">Reference</th>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredTransactions.map((tx) => {
                  const acc = accountMap.get(tx.accountId);
                  return (
                    <tr
                      key={tx.id}
                      tabIndex={0}
                      onClick={() => setSelectedTx(tx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedTx(tx);
                        }
                      }}
                      className="hover:bg-slate-50 transition-colors cursor-pointer focus:outline-none focus:bg-slate-50"
                    >
                      <td className="py-3 px-6">
                        <p className="font-medium text-slate-900">{tx.counterpartyName}</p>
                        <p className="text-xs text-slate-500 truncate max-w-[260px]">
                          {tx.memo || tx.counterpartyDetail}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {acc?.name ?? 'Account'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        <span>{formatTxTypeLabel(tx.txType)}</span>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        <span>{tx.category}</span>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {tx.referenceCode}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            tx.status === 'settled'
                              ? 'text-emerald-700 font-medium'
                              : tx.status === 'pending'
                                ? 'text-amber-700 font-medium'
                                : 'text-slate-500'
                          }
                        >
                          {tx.status === 'settled'
                            ? 'Settled'
                            : tx.status === 'pending'
                              ? 'Pending'
                              : 'Cancelled'}
                        </span>
                      </td>
                      <td
                        className={`py-3 px-6 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                          tx.direction === 'credit' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {formatSignedCents(tx.amountCents, tx.direction, tx.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Receipt Detail Modal */}
      <Modal
        open={!!liveSelectedTx}
        onClose={() => setSelectedTx(null)}
        title="Transaction Receipt"
        subtitle={liveSelectedTx ? `Reference ${liveSelectedTx.referenceCode}` : undefined}
      >
        {liveSelectedTx && (
          <div className="space-y-5">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500">
                  {liveSelectedTx.direction === 'credit' ? 'Funds Received From' : 'Funds Sent To'}
                </p>
                <p className="text-base font-semibold text-slate-900 mt-0.5">
                  {liveSelectedTx.counterpartyName}
                </p>
              </div>
              <p
                className={`text-xl font-semibold font-mono tabular-nums ${
                  liveSelectedTx.direction === 'credit' ? 'text-emerald-700' : 'text-slate-900'
                }`}
              >
                {formatSignedCents(liveSelectedTx.amountCents, liveSelectedTx.direction, liveSelectedTx.currency)}
              </p>
            </div>

            <dl className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-sm">
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Account</dt>
                <dd className="font-medium text-slate-900">
                  {accountMap.get(liveSelectedTx.accountId)?.name ?? liveSelectedTx.accountId}
                </dd>
              </div>
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Rail &amp; Type</dt>
                <dd className="text-slate-900">{formatTxTypeLabel(liveSelectedTx.txType)}</dd>
              </div>
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Counterparty Detail</dt>
                <dd className="text-slate-900 font-mono text-xs">{liveSelectedTx.counterpartyDetail}</dd>
              </div>
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Category</dt>
                <dd className="text-slate-900">{liveSelectedTx.category}</dd>
              </div>
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Status</dt>
                <dd className="capitalize font-medium text-slate-900">{liveSelectedTx.status}</dd>
              </div>
              <div className="px-4 py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500">Timestamp</dt>
                <dd className="font-mono text-xs text-slate-700">
                  {formatDateTime(liveSelectedTx.createdAt)}
                </dd>
              </div>
              {liveSelectedTx.memo && (
                <div className="px-4 py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Memo</dt>
                  <dd className="text-slate-900 text-right">{liveSelectedTx.memo}</dd>
                </div>
              )}
            </dl>

            {liveSelectedTx.status === 'pending' && (
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => handleCancel(liveSelectedTx)}
                  disabled={busyId === liveSelectedTx.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Cancel Entry</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSettle(liveSelectedTx)}
                  disabled={busyId === liveSelectedTx.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {busyId === liveSelectedTx.id
                      ? 'Settling...'
                      : `Settle & ${liveSelectedTx.direction === 'credit' ? 'Credit' : 'Debit'} (${formatCents(liveSelectedTx.amountCents, liveSelectedTx.currency)})`}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
