import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ListOrdered,
  Plus,
} from 'lucide-react';
import {
  formatCents,
  formatDateShort,
  formatSignedCents,
  formatTxTypeLabel,
  maskAccountNumber,
} from '../../lib/format';
import {
  BLUEPRINT_LIMITS,
  type AccountType,
  type ActiveNavSection,
  type BankAccount,
  type CurrencyCode,
  type LedgerTransaction,
} from '../../types/banking';
import { createBankAccount } from '../../services/bankingService';
import { Modal } from '../ui/Modal';

interface OverviewViewProps {
  userId: string;
  accounts: BankAccount[];
  transactions: LedgerTransaction[];
  loading: boolean;
  onNavigate: (section: ActiveNavSection, options?: { receiveTab?: 'direct' | 'requests' }) => void;
  onOpenAccountLedger: (accountId: string) => void;
  onInspectTransaction: (txId: string) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  userId,
  accounts,
  transactions,
  loading,
  onNavigate,
  onOpenAccountLedger,
  onInspectTransaction,
  onNotify,
}) => {
  const [openAccountModal, setOpenAccountModal] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<AccountType>('checking');
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>('USD');
  const [submitting, setSubmitting] = useState(false);

  const primaryCurrency: CurrencyCode = accounts[0]?.currency ?? 'USD';

  const balanceMetrics = useMemo(() => {
    const primaryAccounts = accounts.filter((a) => a.currency === primaryCurrency);
    const totalBalance = primaryAccounts.reduce((sum, a) => sum + a.balanceCents, 0);

    const otherCurrencyTotals = new Map<CurrencyCode, number>();
    for (const acc of accounts) {
      if (acc.currency === primaryCurrency) continue;
      otherCurrencyTotals.set(
        acc.currency,
        (otherCurrencyTotals.get(acc.currency) ?? 0) + acc.balanceCents
      );
    }

    return {
      totalBalance,
      otherCurrencyTotals: Array.from(otherCurrencyTotals.entries()),
    };
  }, [accounts, primaryCurrency]);

  const recentTransactions = useMemo(() => transactions.slice(0, 6), [transactions]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAccName.trim();
    if (trimmed.length < BLUEPRINT_LIMITS.NAME_MIN || trimmed.length > BLUEPRINT_LIMITS.NAME_MAX) {
      onNotify('error', 'Account name must be between 2 and 60 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await createBankAccount({
        userId,
        name: trimmed,
        accountType: newAccType,
        currency: newAccCurrency,
      });
      setNewAccName('');
      setOpenAccountModal(false);
      onNotify('success', `Opened ${trimmed} (${newAccCurrency}).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create account.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-52 bg-[#0B162C] border border-slate-800 rounded-xl p-6 sm:p-8 animate-pulse">
          <div className="h-3 w-36 bg-white/15 rounded mb-4" />
          <div className="h-9 w-52 bg-white/20 rounded" />
        </div>
        <div className="h-64 bg-white border border-slate-200/90 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Deep Navy Balance Hero & Accounts Strip */}
      <section
        aria-label="Account balance and quick actions"
        className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden"
      >
        <div className="bg-gradient-to-br from-[#0B162C] via-[#10203F] to-[#132952] text-white p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-sky-300/90">
              Available Balance ({primaryCurrency})
            </p>
            <p className="mt-1.5 text-3xl sm:text-4xl font-semibold tracking-tight text-white font-mono tabular-nums">
              {formatCents(balanceMetrics.totalBalance, primaryCurrency)}
            </p>
            {balanceMetrics.otherCurrencyTotals.length > 0 && (
              <p className="mt-2 text-xs font-mono tabular-nums text-slate-300">
                Additional currencies:{' '}
                {balanceMetrics.otherCurrencyTotals
                  .map(([curr, sum]) => formatCents(sum, curr))
                  .join(' · ')}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => onNavigate('receive')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0B162C] bg-white hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Receive Funds</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => onNavigate('transfers')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-white/10 border border-white/15 hover:bg-white/15 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Send Money</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => onNavigate('ledger')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-200 bg-white/5 border border-white/10 hover:bg-white/12 hover:text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ListOrdered className="w-4 h-4" />
              <span>View Ledger</span>
            </motion.button>
          </div>
        </div>

        {/* Compact Accounts Strip */}
        <div className="border-y border-slate-200 bg-slate-50/90 px-6 py-3 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold text-slate-700">Your Accounts</h2>
          <button
            type="button"
            onClick={() => setOpenAccountModal(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Open Account</span>
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="px-6 py-6 text-xs text-slate-500">
            No bank accounts open yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {accounts.map((acc) => (
              <motion.button
                key={acc.id}
                type="button"
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.995 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onOpenAccountLedger(acc.id)}
                className="w-full px-6 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-slate-50/90 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{acc.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">
                    {acc.accountType}
                    <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                    <span className="font-mono">{maskAccountNumber(acc.accountNumber)}</span>
                    <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                    <span className={acc.status === 'frozen' ? 'text-red-700 font-medium' : 'text-emerald-700 font-medium'}>
                      {acc.status === 'frozen' ? 'Frozen' : 'Active'}
                    </span>
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums whitespace-nowrap shrink-0">
                  {formatCents(acc.balanceCents, acc.currency)}
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      {/* Recent Transactions */}
      <section className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
        <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">Recent Transactions</h2>
          <button
            type="button"
            onClick={() => onNavigate('ledger')}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap"
          >
            View Full Ledger
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No transactions recorded yet. Use Receive Funds to log your first deposit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                  <th className="py-2.5 px-6">Counterparty</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {recentTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    tabIndex={0}
                    onClick={() => onInspectTransaction(tx.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onInspectTransaction(tx.id);
                      }
                    }}
                    className="hover:bg-slate-50/90 transition-colors cursor-pointer focus:outline-none focus:bg-slate-50"
                  >
                    <td className="py-3 px-6">
                      <p className="font-medium text-slate-900">{tx.counterpartyName}</p>
                      <p className="text-xs text-slate-500">{tx.counterpartyDetail}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {formatTxTypeLabel(tx.txType)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                      {formatDateShort(tx.createdAt)}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={openAccountModal}
        onClose={() => setOpenAccountModal(false)}
        title="Open New Bank Account"
        subtitle="Create an additional checking, savings, or treasury reserve account"
      >
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <div>
            <label htmlFor="new-acc-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Account Name
            </label>
            <input
              id="new-acc-name"
              type="text"
              required
              minLength={2}
              maxLength={BLUEPRINT_LIMITS.NAME_MAX}
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
              placeholder="e.g. Tax Escrow or Payroll Clearing"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-acc-type" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account Type
              </label>
              <select
                id="new-acc-type"
                value={newAccType}
                onChange={(e) => setNewAccType(e.target.value as AccountType)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="treasury">Treasury</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-acc-curr" className="block text-xs font-medium text-slate-700 mb-1.5">
                Currency
              </label>
              <select
                id="new-acc-curr"
                value={newAccCurrency}
                onChange={(e) => setNewAccCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setOpenAccountModal(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'Opening...' : 'Open Account'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
