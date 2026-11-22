import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  CreditCard,
  Download,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Unlock,
  XCircle,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  exportTransactionsCsv,
  formatCents,
  formatDateTime,
  formatSignedCents,
  formatTxTypeLabel,
  parseDollarsToCents,
  timestampToMs,
} from '../../lib/format';
import {
  BLUEPRINT_LIMITS,
  PRIMARY_ADMIN_EMAIL,
  isWithdrawalAccessFrozen,
  type AccountType,
  type AdminRecord,
  type AdminTopUpFundingMode,
  type BankAccount,
  type CurrencyCode,
  type LedgerTransaction,
  type PaymentRequest,
  type TxStatus,
  type UserProfile,
  type VirtualCard,
} from '../../types/banking';
import {
  adminCreateBankAccountForUser,
  adminGrantAdminAccess,
  adminRevokeAdminAccess,
  adminSetUserWithdrawalFrozen,
  adminSettlePaymentRequest,
  adminSettlePendingTransaction,
  adminTopUpAccount,
  cancelPaymentRequest,
  cancelPendingTransaction,
  renameBankAccount,
  toggleAccountStatus,
  toggleCardStatus,
  updateCardLimit,
} from '../../services/bankingService';
import { Modal } from '../ui/Modal';
import { SegmentedTabs } from '../ui/SegmentedTabs';

interface AdminConsoleViewProps {
  adminUid: string;
  adminName: string;
  adminAccounts: BankAccount[];
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type AdminTab = 'users' | 'ledger' | 'cards' | 'requests';

export const AdminConsoleView: React.FC<AdminConsoleViewProps> = ({
  adminUid,
  adminName,
  adminAccounts,
  onNotify,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allAccounts, setAllAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<LedgerTransaction[]>([]);
  const [allRequests, setAllRequests] = useState<PaymentRequest[]>([]);
  const [allCards, setAllCards] = useState<VirtualCard[]>([]);
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([]);

  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState<'all' | TxStatus>('all');

  // Direct Admin Top-Up State
  const topUpSectionRef = useRef<HTMLDivElement | null>(null);
  const [targetAccountId, setTargetAccountId] = useState('');
  const [fundingMode, setFundingMode] = useState<AdminTopUpFundingMode>('treasury_issuance');
  const [sourceAdminAccountId, setSourceAdminAccountId] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpMemo, setTopUpMemo] = useState('');
  const [submittingTopUp, setSubmittingTopUp] = useState(false);

  // Create Account for User Modal/Inline Form
  const [createAccUser, setCreateAccUser] = useState<UserProfile | null>(null);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<AccountType>('checking');
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>('USD');
  const [newAccInitialAmount, setNewAccInitialAmount] = useState('0.00');
  const [creatingAcc, setCreatingAcc] = useState(false);

  // Inline Edits & Action Busy Indicators
  const [renamingAccId, setRenamingAccId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardLimitDollars, setEditCardLimitDollars] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 6) {
        setLoading(false);
      }
    };

    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      setLoadError(err instanceof Error ? err.message : `Unable to load ${path}`);
      setLoading(false);
      handleFirestoreError(err, op, path);
    };

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as UserProfile)
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setAllUsers(list);
        markLoaded();
      },
      handleErr(OperationType.LIST, 'users')
    );

    const unsubAccounts = onSnapshot(
      collection(db, 'accounts'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as BankAccount)
          .sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt));
        setAllAccounts(list);
        markLoaded();
      },
      handleErr(OperationType.LIST, 'accounts')
    );

    const unsubTransactions = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as LedgerTransaction)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setAllTransactions(list);
        markLoaded();
      },
      handleErr(OperationType.LIST, 'transactions')
    );

    const unsubRequests = onSnapshot(
      collection(db, 'paymentRequests'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as PaymentRequest)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setAllRequests(list);
        markLoaded();
      },
      handleErr(OperationType.LIST, 'paymentRequests')
    );

    const unsubCards = onSnapshot(
      collection(db, 'cards'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as VirtualCard)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setAllCards(list);
        markLoaded();
      },
      handleErr(OperationType.LIST, 'cards')
    );

    const unsubAdmins = onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        setAdminRecords(snap.docs.map((d) => d.data() as AdminRecord));
        markLoaded();
      },
      handleErr(OperationType.LIST, 'admins')
    );

    return () => {
      unsubUsers();
      unsubAccounts();
      unsubTransactions();
      unsubRequests();
      unsubCards();
      unsubAdmins();
    };
  }, []);

  const userMap = useMemo(() => new Map(allUsers.map((u) => [u.uid, u])), [allUsers]);
  const accountMap = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  const delegatedAdminSet = useMemo(() => new Set(adminRecords.map((r) => r.uid)), [adminRecords]);

  const effectiveTargetAccountId = targetAccountId || allAccounts[0]?.id || '';
  const selectedTargetAccount = allAccounts.find((a) => a.id === effectiveTargetAccountId) ?? null;

  const eligibleAdminFundingAccounts = useMemo(() => {
    if (!selectedTargetAccount) return adminAccounts.filter((a) => a.status === 'active');
    return adminAccounts.filter(
      (a) =>
        a.status === 'active' &&
        a.currency === selectedTargetAccount.currency &&
        a.id !== selectedTargetAccount.id
    );
  }, [adminAccounts, selectedTargetAccount]);

  const effectiveSourceAdminAccountId = useMemo(() => {
    if (eligibleAdminFundingAccounts.some((a) => a.id === sourceAdminAccountId)) {
      return sourceAdminAccountId;
    }
    return eligibleAdminFundingAccounts[0]?.id ?? '';
  }, [eligibleAdminFundingAccounts, sourceAdminAccountId]);

  const liquidityByCurrency = useMemo(() => {
    const totals: Record<CurrencyCode, number> = { USD: 0, EUR: 0, GBP: 0 };
    for (const acc of allAccounts) {
      totals[acc.currency] = (totals[acc.currency] ?? 0) + acc.balanceCents;
    }
    return totals;
  }, [allAccounts]);

  const pendingTxCount = useMemo(
    () => allTransactions.filter((t) => t.status === 'pending').length,
    [allTransactions]
  );
  const pendingReqCount = useMemo(
    () => allRequests.filter((r) => r.status === 'pending').length,
    [allRequests]
  );
  const activeCardsCount = useMemo(
    () => allCards.filter((c) => c.status === 'active').length,
    [allCards]
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    if (!normalizedSearch) return allUsers;
    return allUsers.filter((u) => {
      const userAccounts = allAccounts.filter((a) => a.userId === u.uid);
      const matchesUser =
        u.displayName.toLowerCase().includes(normalizedSearch) ||
        u.email.toLowerCase().includes(normalizedSearch) ||
        u.handle.toLowerCase().includes(normalizedSearch) ||
        (u.dateOfBirth?.includes(normalizedSearch) ?? false) ||
        (u.gender?.toLowerCase().includes(normalizedSearch) ?? false) ||
        (u.primaryAccountNumber?.includes(normalizedSearch) ?? false) ||
        (u.primaryRoutingNumber?.includes(normalizedSearch) ?? false);
      const matchesAccount = userAccounts.some(
        (a) =>
          a.name.toLowerCase().includes(normalizedSearch) ||
          a.accountNumber.includes(normalizedSearch) ||
          a.routingNumber.includes(normalizedSearch)
      );
      return matchesUser || matchesAccount;
    });
  }, [allUsers, allAccounts, normalizedSearch]);

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      if (txStatusFilter !== 'all' && tx.status !== txStatusFilter) return false;
      if (!normalizedSearch) return true;
      const owner = userMap.get(tx.userId);
      const acc = accountMap.get(tx.accountId);
      return (
        tx.referenceCode.toLowerCase().includes(normalizedSearch) ||
        tx.counterpartyName.toLowerCase().includes(normalizedSearch) ||
        tx.category.toLowerCase().includes(normalizedSearch) ||
        (owner?.displayName.toLowerCase().includes(normalizedSearch) ?? false) ||
        (owner?.email.toLowerCase().includes(normalizedSearch) ?? false) ||
        (acc?.name.toLowerCase().includes(normalizedSearch) ?? false)
      );
    });
  }, [allTransactions, txStatusFilter, normalizedSearch, userMap, accountMap]);

  const filteredCards = useMemo(() => {
    if (!normalizedSearch) return allCards;
    return allCards.filter((c) => {
      const owner = userMap.get(c.userId);
      return (
        c.label.toLowerCase().includes(normalizedSearch) ||
        c.holderName.toLowerCase().includes(normalizedSearch) ||
        c.last4.includes(normalizedSearch) ||
        (owner?.email.toLowerCase().includes(normalizedSearch) ?? false)
      );
    });
  }, [allCards, normalizedSearch, userMap]);

  const filteredRequests = useMemo(() => {
    if (!normalizedSearch) return allRequests;
    return allRequests.filter((r) => {
      const owner = userMap.get(r.userId);
      return (
        r.title.toLowerCase().includes(normalizedSearch) ||
        r.payerName.toLowerCase().includes(normalizedSearch) ||
        r.referenceCode.toLowerCase().includes(normalizedSearch) ||
        (owner?.displayName.toLowerCase().includes(normalizedSearch) ?? false)
      );
    });
  }, [allRequests, normalizedSearch, userMap]);

  const handleSelectAccountForTopUp = (accountId: string) => {
    setTargetAccountId(accountId);
    topUpSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetAccount) {
      onNotify('error', 'Select a target bank account.');
      return;
    }
    const cents = parseDollarsToCents(topUpAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid positive top-up amount.');
      return;
    }
    if (fundingMode === 'admin_account_debit' && !effectiveSourceAdminAccountId) {
      onNotify('error', 'No active matching-currency admin account is available to debit.');
      return;
    }

    setSubmittingTopUp(true);
    try {
      const ref = await adminTopUpAccount({
        adminUserId: adminUid,
        adminName,
        targetAccountId: selectedTargetAccount.id,
        amountCents: cents,
        fundingMode,
        sourceAdminAccountId:
          fundingMode === 'admin_account_debit' ? effectiveSourceAdminAccountId : undefined,
        memo: topUpMemo.trim(),
      });
      const owner = userMap.get(selectedTargetAccount.userId);
      setTopUpAmount('');
      setTopUpMemo('');
      onNotify(
        'success',
        `Topped up ${owner?.displayName ?? 'user'}'s ${selectedTargetAccount.name} with ${formatCents(cents, selectedTargetAccount.currency)} (${ref}).`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Admin top-up failed.');
    } finally {
      setSubmittingTopUp(false);
    }
  };

  const handleCreateAccountForUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createAccUser) return;
    if (newAccName.trim().length < BLUEPRINT_LIMITS.NAME_MIN) {
      onNotify('error', 'Account name must be at least 2 characters.');
      return;
    }
    const cleanedInit = newAccInitialAmount.replace(/[,$\s]/g, '').trim();
    const initialCents =
      cleanedInit === '' || Number(cleanedInit) === 0 ? 0 : parseDollarsToCents(cleanedInit);
    if (initialCents === null || initialCents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid non-negative opening balance up to $100,000,000.00.');
      return;
    }

    setCreatingAcc(true);
    try {
      await adminCreateBankAccountForUser({
        targetUser: createAccUser,
        name: newAccName.trim(),
        accountType: newAccType,
        currency: newAccCurrency,
        initialBalanceCents: initialCents,
      });
      onNotify('success', `Opened ${newAccName.trim()} for ${createAccUser.displayName}.`);
      setCreateAccUser(null);
      setNewAccName('');
      setNewAccInitialAmount('0.00');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setCreatingAcc(false);
    }
  };

  const handleToggleAccount = async (acc: BankAccount) => {
    const nextStatus = acc.status === 'active' ? 'frozen' : 'active';
    setBusyId(acc.id);
    try {
      await toggleAccountStatus(acc.id, nextStatus);
      onNotify('success', `${acc.name} is now ${nextStatus}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update account status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveRename = async (accId: string) => {
    setBusyId(accId);
    try {
      await renameBankAccount(accId, renameValue);
      setRenamingAccId(null);
      onNotify('success', 'Account renamed.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Rename failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleAdminRole = async (u: UserProfile) => {
    if (u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() || u.uid === adminUid) {
      return;
    }
    const currentlyAdmin = delegatedAdminSet.has(u.uid);
    setBusyId(`role_${u.uid}`);
    try {
      if (currentlyAdmin) {
        await adminRevokeAdminAccess(u.uid);
        onNotify('success', `Revoked admin privileges for ${u.displayName}.`);
      } else {
        await adminGrantAdminAccess({ targetUser: u, grantedBy: adminName });
        onNotify('success', `Granted delegated admin access to ${u.displayName}.`);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update admin role.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleUserWithdrawalFreeze = async (u: UserProfile) => {
    const nextFrozen = !isWithdrawalAccessFrozen(u);
    setBusyId(`withdraw_${u.uid}`);
    try {
      await adminSetUserWithdrawalFrozen(u.uid, nextFrozen);
      onNotify(
        'success',
        nextFrozen
          ? `Froze withdrawal access for ${u.displayName}.`
          : `Unfroze withdrawal access for ${u.displayName}.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update withdrawal access.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSettleTx = async (tx: LedgerTransaction) => {
    setBusyId(tx.id);
    try {
      await adminSettlePendingTransaction(tx.id);
      onNotify('success', `Settled transaction ${tx.referenceCode}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to settle transaction.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelTx = async (tx: LedgerTransaction) => {
    setBusyId(tx.id);
    try {
      await cancelPendingTransaction(tx.id);
      onNotify('success', `Cancelled pending transaction ${tx.referenceCode}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel transaction.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleCard = async (card: VirtualCard) => {
    const next = card.status === 'active' ? 'frozen' : 'active';
    setBusyId(card.id);
    try {
      await toggleCardStatus(card.id, next);
      onNotify('success', `Card •••• ${card.last4} is now ${next}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update card.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveCardLimit = async (card: VirtualCard) => {
    const cents = parseDollarsToCents(editCardLimitDollars);
    if (
      !cents ||
      cents < BLUEPRINT_LIMITS.MIN_CARD_LIMIT_CENTS ||
      cents > BLUEPRINT_LIMITS.MAX_CARD_LIMIT_CENTS
    ) {
      onNotify('error', 'Card limit must be between $10.00 and $10,000,000.00.');
      return;
    }
    setBusyId(card.id);
    try {
      await updateCardLimit(card.id, cents);
      setEditingCardId(null);
      onNotify('success', `Updated limit for •••• ${card.last4}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update card limit.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSettleRequest = async (req: PaymentRequest) => {
    setBusyId(req.id);
    try {
      const ref = await adminSettlePaymentRequest(req.id);
      onNotify('success', `Marked payment request ${ref} paid and credited user account.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to settle payment request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelRequest = async (req: PaymentRequest) => {
    setBusyId(req.id);
    try {
      await cancelPaymentRequest(req.id);
      onNotify('success', `Cancelled payment request ${req.referenceCode}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel payment request.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {/* System KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-[#0B162C] via-[#10203F] to-[#132952] text-white border border-slate-800 rounded-xl shadow-xs p-5">
          <p className="text-xs font-medium text-sky-300/90">System USD Liquidity</p>
          <p className="text-2xl font-bold text-white font-mono tabular-nums mt-1.5">
            {formatCents(liquidityByCurrency.USD, 'USD')}
          </p>
          {(liquidityByCurrency.EUR > 0 || liquidityByCurrency.GBP > 0) && (
            <p className="text-[11px] text-slate-300 font-mono tabular-nums mt-1">
              EUR {formatCents(liquidityByCurrency.EUR, 'EUR')} · GBP {formatCents(liquidityByCurrency.GBP, 'GBP')}
            </p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Registered Users &amp; Accounts</p>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {allUsers.length} <span className="text-sm font-normal text-slate-500">users</span>
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {allAccounts.length} accounts · {allUsers.filter((u) => isWithdrawalAccessFrozen(u)).length} withdrawals frozen
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Pending Approvals</p>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {pendingTxCount + pendingReqCount}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {pendingTxCount} ledger · {pendingReqCount} requests
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Virtual Cards Issued</p>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {activeCardsCount}{' '}
            <span className="text-sm font-normal text-slate-500">/ {allCards.length} active</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Primary admin: <span className="font-mono">{PRIMARY_ADMIN_EMAIL}</span>
          </p>
        </div>
      </div>

      {/* Direct Admin Account Top-Up Panel */}
      <div
        ref={topUpSectionRef}
        className="bg-white border border-slate-200 rounded-xl p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Coins className="w-4 h-4 text-blue-700" />
              <span>Admin Direct Account Top-Up</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Credit any active user account via System Treasury Issuance or by debiting one of your admin bank accounts
            </p>
          </div>
          <SegmentedTabs
            layoutId="adminFundingMode"
            size="sm"
            value={fundingMode}
            onChange={setFundingMode}
            options={[
              { id: 'treasury_issuance', label: 'System Treasury Issuance' },
              { id: 'admin_account_debit', label: 'Debit Admin Account' },
            ]}
          />
        </div>

        <form onSubmit={handleTopUpSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className={fundingMode === 'admin_account_debit' ? 'md:col-span-4' : 'md:col-span-5'}>
            <label htmlFor="admin-topup-target" className="block text-xs font-medium text-slate-700 mb-1.5">
              Target User Account
            </label>
            <select
              id="admin-topup-target"
              value={effectiveTargetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            >
              {allAccounts.map((acc) => {
                const owner = userMap.get(acc.userId);
                return (
                  <option key={acc.id} value={acc.id}>
                    {owner?.displayName ?? acc.userId} ({owner?.email ?? 'user'}) — {acc.name} ···· {acc.accountNumber.slice(-4)} [{formatCents(acc.balanceCents, acc.currency)}] {acc.status === 'frozen' ? '(FROZEN)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {fundingMode === 'admin_account_debit' && (
            <div className="md:col-span-3">
              <label htmlFor="admin-topup-source" className="block text-xs font-medium text-slate-700 mb-1.5">
                Funding Admin Account
              </label>
              <select
                id="admin-topup-source"
                value={effectiveSourceAdminAccountId}
                onChange={(e) => setSourceAdminAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                {eligibleAdminFundingAccounts.length === 0 ? (
                  <option value="">No matching active admin account</option>
                ) : (
                  eligibleAdminFundingAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatCents(acc.balanceCents, acc.currency)})
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          <div className="md:col-span-2">
            <label htmlFor="admin-topup-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
              Amount ({selectedTargetAccount?.currency ?? 'USD'})
            </label>
            <input
              id="admin-topup-amount"
              type="text"
              inputMode="decimal"
              required
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              placeholder="1000.00"
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className={fundingMode === 'admin_account_debit' ? 'md:col-span-3' : 'md:col-span-3'}>
            <label htmlFor="admin-topup-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
              Audit Memo
            </label>
            <input
              id="admin-topup-memo"
              type="text"
              maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
              value={topUpMemo}
              onChange={(e) => setTopUpMemo(e.target.value)}
              placeholder="e.g. Onboarding liquidity grant"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={
                submittingTopUp ||
                !selectedTargetAccount ||
                selectedTargetAccount.status === 'frozen' ||
                (fundingMode === 'admin_account_debit' && !effectiveSourceAdminAccountId)
              }
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Coins className="w-4 h-4 shrink-0" />
              <span>{submittingTopUp ? 'Crediting...' : 'Execute Top-Up'}</span>
            </button>
          </div>
        </form>

        {(selectedTargetAccount?.status === 'frozen' ||
          (fundingMode === 'admin_account_debit' && !effectiveSourceAdminAccountId && selectedTargetAccount)) && (
          <div
            role="alert"
            className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              {selectedTargetAccount?.status === 'frozen'
                ? `${selectedTargetAccount.name} is currently frozen. Unfreeze it in Users & Accounts before initiating a top-up.`
                : `No active ${selectedTargetAccount?.currency ?? ''} admin account is available to debit. Switch to System Treasury Issuance or open an active ${selectedTargetAccount?.currency ?? ''} account first.`}
            </span>
          </div>
        )}
      </div>

      {/* Create Account Modal for a User */}
      <Modal
        open={!!createAccUser}
        onClose={() => setCreateAccUser(null)}
        title={createAccUser ? `Open Bank Account for ${createAccUser.displayName}` : 'Open Bank Account'}
        subtitle={createAccUser?.email}
      >
        <form onSubmit={handleCreateAccountForUser} className="space-y-4">
          <div>
            <label htmlFor="adm-new-acc-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Account Name
            </label>
            <input
              id="adm-new-acc-name"
              type="text"
              required
              minLength={BLUEPRINT_LIMITS.NAME_MIN}
              maxLength={BLUEPRINT_LIMITS.NAME_MAX}
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
              placeholder="e.g. Reserve Treasury"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="adm-new-acc-type" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account Type
              </label>
              <select
                id="adm-new-acc-type"
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
              <label htmlFor="adm-new-acc-curr" className="block text-xs font-medium text-slate-700 mb-1.5">
                Currency
              </label>
              <select
                id="adm-new-acc-curr"
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

          <div>
            <label htmlFor="adm-new-acc-bal" className="block text-xs font-medium text-slate-700 mb-1.5">
              Opening Balance ({newAccCurrency})
            </label>
            <input
              id="adm-new-acc-bal"
              type="text"
              inputMode="decimal"
              value={newAccInitialAmount}
              onChange={(e) => setNewAccInitialAmount(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setCreateAccUser(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingAcc}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {creatingAcc ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Governance Tabs + Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SegmentedTabs
          layoutId="adminGovernanceTabs"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { id: 'users', label: `Users & Accounts (${allUsers.length})` },
            { id: 'ledger', label: `Global Ledger (${allTransactions.length})` },
            { id: 'cards', label: `Cards & Limits (${allCards.length})` },
            { id: 'requests', label: `Payment Requests (${allRequests.length})` },
          ]}
        />

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter users, accounts, refs..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Tab 1: Users & Accounts */}
        {activeTab === 'users' && (
          <motion.div
            key="admin-users"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
          {filteredUsers.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              No matching users or accounts found.
            </div>
          ) : (
            filteredUsers.map((u) => {
              const userAccounts = allAccounts.filter((a) => a.userId === u.uid);
              const isPrimary = u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
              const isDelegated = delegatedAdminSet.has(u.uid);
              const withdrawalFrozen = isWithdrawalAccessFrozen(u);

              return (
                <div
                  key={u.uid}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                >
                  <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{u.displayName}</h3>
                        {(isPrimary || isDelegated) && (
                          <span className="text-[11px] font-medium text-blue-700">
                            {isPrimary ? 'Primary Admin' : 'Admin'}
                          </span>
                        )}
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span
                          className={`text-[11px] font-medium ${
                            withdrawalFrozen ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          Withdrawals: {withdrawalFrozen ? 'Frozen' : 'Active'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {u.handle} · {u.email}
                        {u.dateOfBirth ? ` · DOB ${u.dateOfBirth}` : ''}
                        {u.gender ? ` · ${u.gender}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleUserWithdrawalFreeze(u)}
                        disabled={busyId === `withdraw_${u.uid}`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                          withdrawalFrozen
                            ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                            : 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100'
                        }`}
                      >
                        {withdrawalFrozen ? (
                          <>
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Unfreeze Withdrawals</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>Freeze Withdrawals</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCreateAccUser(u);
                          setNewAccName('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Open Account</span>
                      </button>

                      {!isPrimary && u.uid !== adminUid && (
                        <button
                          type="button"
                          onClick={() => handleToggleAdminRole(u)}
                          disabled={busyId === `role_${u.uid}`}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                            isDelegated
                              ? 'text-red-700 bg-red-50 border-red-200 hover:bg-red-100'
                              : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          {isDelegated ? (
                            <>
                              <ShieldOff className="w-3.5 h-3.5" />
                              <span>Revoke Admin</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Make Admin</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {userAccounts.length === 0 ? (
                    <div className="px-6 py-5 text-xs text-slate-500">
                      No deposit accounts opened for this user yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {userAccounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4"
                        >
                          <div className="min-w-0">
                            {renamingAccId === acc.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  maxLength={BLUEPRINT_LIMITS.NAME_MAX}
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-md"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveRename(acc.id)}
                                  disabled={busyId === acc.id}
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-slate-900 rounded-md cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRenamingAccId(null)}
                                  className="px-2 py-1 text-xs text-slate-500 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <p className="text-sm font-medium text-slate-900">
                                {acc.name}{' '}
                                <span
                                  className={`ml-1.5 text-[11px] font-normal ${
                                    acc.status === 'active' ? 'text-emerald-700' : 'text-amber-700'
                                  }`}
                                >
                                  ({acc.status})
                                </span>
                              </p>
                            )}
                            <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                              {acc.accountType} · Acct {acc.accountNumber} · Routine {acc.routingNumber} · {acc.currency}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                              {formatCents(acc.balanceCents, acc.currency)}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleSelectAccountForTopUp(acc.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              <span>Top Up</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setRenamingAccId(acc.id);
                                setRenameValue(acc.name);
                              }}
                              aria-label="Rename account"
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleAccount(acc)}
                              disabled={busyId === acc.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-60"
                            >
                              {acc.status === 'active' ? (
                                <>
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Freeze</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>Unfreeze</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          </motion.div>
        )}

        {/* Tab 2: Global Ledger */}
        {activeTab === 'ledger' && (
          <motion.div
            key="admin-ledger"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-slate-200/90 shadow-xs rounded-xl overflow-hidden"
          >
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'pending', 'settled', 'cancelled'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setTxStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
                    txStatusFilter === status
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportTransactionsCsv(filteredTransactions, allAccounts)}
              disabled={filteredTransactions.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No ledger entries match your filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-3 px-4">Date &amp; Ref</th>
                    <th className="py-3 px-4">User &amp; Account</th>
                    <th className="py-3 px-4">Counterparty</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredTransactions.slice(0, 100).map((tx) => {
                    const owner = userMap.get(tx.userId);
                    const acc = accountMap.get(tx.accountId);
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="text-slate-700 tabular-nums">{formatDateTime(tx.createdAt)}</p>
                          <p className="font-mono text-[11px] text-slate-400">{tx.referenceCode}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{owner?.displayName ?? tx.userId}</p>
                          <p className="text-[11px] text-slate-500">{acc?.name ?? tx.accountId}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{tx.counterpartyName}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            {tx.memo || tx.counterpartyDetail}
                          </p>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                          {formatTxTypeLabel(tx.txType)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`font-medium capitalize ${
                              tx.status === 'settled'
                                ? 'text-emerald-700'
                                : tx.status === 'pending'
                                  ? 'text-amber-700'
                                  : 'text-slate-400'
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            tx.direction === 'credit' ? 'text-emerald-700' : 'text-slate-900'
                          }`}
                        >
                          {formatSignedCents(tx.amountCents, tx.direction, tx.currency)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {tx.status === 'pending' ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSettleTx(tx)}
                                disabled={busyId === tx.id}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Settle</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelTx(tx)}
                                disabled={busyId === tx.id}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded cursor-pointer"
                              >
                                <XCircle className="w-3 h-3" />
                                <span>Cancel</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredTransactions.length > 100 && (
                <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                  Showing latest 100 of {filteredTransactions.length} matching entries. Refine filters or Export CSV for the complete ledger.
                </div>
              )}
            </div>
          )}
          </motion.div>
        )}

        {/* Tab 3: Cards & Limits */}
        {activeTab === 'cards' && (
          <motion.div
            key="admin-cards"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
          {filteredCards.length === 0 ? (
            <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              No virtual cards match your search.
            </div>
          ) : (
            filteredCards.map((card) => {
              const owner = userMap.get(card.userId);
              const linkedAcc = accountMap.get(card.accountId);
              const cardCurr = linkedAcc?.currency ?? 'USD';
              const pct = Math.min(
                100,
                Math.round((card.spentThisMonthCents / Math.max(1, card.monthlyLimitCents)) * 100)
              );

              return (
                <div key={card.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-slate-500" />
                        <span>{card.label}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {owner?.displayName ?? card.holderName} · {linkedAcc?.name ?? 'Account'} · {card.network}{' '}
                        <span className="font-mono">•••• {card.last4}</span> · Exp {card.expiry}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-medium capitalize ${
                        card.status === 'active' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {card.status}
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-600 mb-1.5 font-mono tabular-nums">
                      <span>Spent: {formatCents(card.spentThisMonthCents, cardCurr)}</span>
                      <span>Limit: {formatCents(card.monthlyLimitCents, cardCurr)}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {editingCardId === card.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editCardLimitDollars}
                        onChange={(e) => setEditCardLimitDollars(e.target.value)}
                        placeholder="5000.00"
                        className="flex-1 px-3 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveCardLimit(card)}
                        disabled={busyId === card.id}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg cursor-pointer"
                      >
                        Save Limit
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCardId(null)}
                        className="px-2 py-1.5 text-xs text-slate-500 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCardId(card.id);
                          setEditCardLimitDollars((card.monthlyLimitCents / 100).toFixed(2));
                        }}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                      >
                        Edit Monthly Limit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCard(card)}
                        disabled={busyId === card.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-60"
                      >
                        {card.status === 'active' ? (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>Freeze Card</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Unfreeze Card</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          </motion.div>
        )}

        {/* Tab 4: Payment Requests */}
        {activeTab === 'requests' && (
          <motion.div
            key="admin-requests"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-slate-200/90 shadow-xs rounded-xl overflow-hidden"
          >
          {filteredRequests.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No payment requests match your search.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredRequests.map((req) => {
                const owner = userMap.get(req.userId);
                const acc = accountMap.get(req.accountId);
                return (
                  <div
                    key={req.id}
                    className="px-6 py-4 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{req.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Recipient: <span className="font-medium text-slate-700">{owner?.displayName ?? req.userId}</span>{' '}
                        ({acc?.name ?? req.accountId}) · Payer: {req.payerName} ·{' '}
                        <span className="font-mono">{req.referenceCode}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                        {formatCents(req.amountCents, req.currency)}
                      </span>
                      {req.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSettleRequest(req)}
                            disabled={busyId === req.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Paid</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelRequest(req)}
                            disabled={busyId === req.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        </>
                      ) : (
                        <span
                          className={`text-xs font-medium capitalize ${
                            req.status === 'paid' ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {req.status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
