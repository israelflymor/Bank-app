import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Search,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { formatCents, getLocalDateStringOffset, parseDollarsToCents } from '../../lib/format';
import {
  BLUEPRINT_LIMITS,
  PRIMARY_ADMIN_EMAIL,
  WITHDRAWAL_FROZEN_MESSAGE,
  isWithdrawalAccessFrozen,
  type BankAccount,
  type Beneficiary,
  type RecipientDirectoryEntry,
  type ScheduledCadence,
  type ScheduledPayment,
  type UserProfile,
} from '../../types/banking';
import {
  cancelScheduledPayment,
  createBeneficiary,
  createScheduledPayment,
  executeExternalTransfer,
  executeInternalTransfer,
  executePeerTransfer,
  executeScheduledPaymentNow,
  resolveTransferRecipient,
} from '../../services/bankingService';
import { SegmentedTabs } from '../ui/SegmentedTabs';

interface TransferFundsProps {
  userId: string;
  profile: UserProfile | null;
  accounts: BankAccount[];
  beneficiaries: Beneficiary[];
  scheduledPayments: ScheduledPayment[];
  preselectedBeneficiaryId?: string | null;
  onClearPreselectedBeneficiary?: () => void;
  onWithdrawalBlocked: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type TransferMode = 'peer' | 'internal' | 'external' | 'scheduled';

export const TransferFunds: React.FC<TransferFundsProps> = ({
  userId,
  profile,
  accounts,
  beneficiaries,
  scheduledPayments,
  preselectedBeneficiaryId,
  onClearPreselectedBeneficiary,
  onWithdrawalBlocked,
  onNotify,
}) => {
  const [mode, setMode] = useState<TransferMode>('peer');

  // Peer / Account Number Transfer
  const [peerSourceId, setPeerSourceId] = useState<string>(accounts[0]?.id ?? '');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [lookingUpRecipient, setLookingUpRecipient] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [resolvedRecipient, setResolvedRecipient] = useState<RecipientDirectoryEntry | null>(null);
  const [peerAmount, setPeerAmount] = useState('');
  const [peerMemo, setPeerMemo] = useState('');
  const [sendingPeer, setSendingPeer] = useState(false);

  // External Transfer
  const [extAccountId, setExtAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [customBank, setCustomBank] = useState('');
  const [customRouting, setCustomRouting] = useState('');
  const [customLast4, setCustomLast4] = useState('');
  const [saveAsBeneficiary, setSaveAsBeneficiary] = useState(false);
  const [extAmount, setExtAmount] = useState('');
  const [extCategory, setExtCategory] = useState('Vendor Payment');
  const [extMemo, setExtMemo] = useState('');
  const [sendingExt, setSendingExt] = useState(false);

  // Internal Transfer
  const [fromAccountId, setFromAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState<string>(accounts[1]?.id ?? accounts[0]?.id ?? '');
  const [intAmount, setIntAmount] = useState('');
  const [intMemo, setIntMemo] = useState('');
  const [sendingInt, setSendingInt] = useState(false);

  // Scheduled Bill Pay
  const [schAccountId, setSchAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [schPayee, setSchPayee] = useState('');
  const [schCategory, setSchCategory] = useState('Utilities');
  const [schAmount, setSchAmount] = useState('');
  const [schCadence, setSchCadence] = useState<ScheduledCadence>('monthly');
  const [schDueDate, setSchDueDate] = useState(() => getLocalDateStringOffset(7));
  const [creatingSch, setCreatingSch] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [cancellingSchId, setCancellingSchId] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedBeneficiaryId) {
      setMode('external');
      setSelectedBeneficiaryId(preselectedBeneficiaryId);
      onClearPreselectedBeneficiary?.();
    }
  }, [preselectedBeneficiaryId, onClearPreselectedBeneficiary]);

  useEffect(() => {
    if (selectedBeneficiaryId && !beneficiaries.some((b) => b.id === selectedBeneficiaryId)) {
      setSelectedBeneficiaryId('');
    }
  }, [beneficiaries, selectedBeneficiaryId]);

  const effectivePeerSourceId = peerSourceId || accounts[0]?.id || '';
  const effectiveExtAccountId = extAccountId || accounts[0]?.id || '';
  const effectiveFromId = fromAccountId || accounts[0]?.id || '';
  const effectiveToId = toAccountId || accounts[1]?.id || accounts[0]?.id || '';
  const effectiveSchAccountId = schAccountId || accounts[0]?.id || '';

  const peerSourceAccount = accounts.find((a) => a.id === effectivePeerSourceId);
  const extSourceAccount = accounts.find((a) => a.id === effectiveExtAccountId);
  const fromAccount = accounts.find((a) => a.id === effectiveFromId);
  const toAccount = accounts.find((a) => a.id === effectiveToId);
  const schSourceAccount = accounts.find((a) => a.id === effectiveSchAccountId);

  const selectedBeneficiary = beneficiaries.find((b) => b.id === selectedBeneficiaryId) ?? null;
  const withdrawalFrozen = isWithdrawalAccessFrozen(profile);

  const peerBlockReason = (() => {
    if (!peerSourceAccount) return 'Select an active source account.';
    if (peerSourceAccount.status !== 'active') {
      return `${peerSourceAccount.name} is currently frozen. Select an active account or contact an administrator (${PRIMARY_ADMIN_EMAIL}).`;
    }
    if (!resolvedRecipient) return null;
    if (resolvedRecipient.accountId === peerSourceAccount.id) {
      return 'Recipient account matches the selected source account. Choose a different account.';
    }
    if (resolvedRecipient.status !== 'active') {
      return 'Recipient account is currently frozen and cannot receive transfers.';
    }
    if (resolvedRecipient.currency !== peerSourceAccount.currency) {
      return `Currency mismatch (${peerSourceAccount.currency} source vs ${resolvedRecipient.currency} recipient).`;
    }
    return null;
  })();

  const internalTransferBlockReason = (() => {
    if (accounts.length < 2) return 'Open a second account to transfer internally.';
    if (!fromAccount || !toAccount) return 'Select both source and destination accounts.';
    if (fromAccount.id === toAccount.id) {
      return 'Source and destination accounts must be different.';
    }
    if (fromAccount.currency !== toAccount.currency) {
      return `Currency mismatch (${fromAccount.currency} to ${toAccount.currency}). Internal transfers require matching currencies.`;
    }
    if (fromAccount.status !== 'active' || toAccount.status !== 'active') {
      return 'Both source and destination accounts must be active (not frozen).';
    }
    return null;
  })();

  const performRecipientLookup = async (rawInput: string): Promise<RecipientDirectoryEntry | null> => {
    const cleaned = rawInput.trim();
    if (!cleaned) {
      setLookupError('Enter a Kestrel @handle, verified email, or 10–12 digit account number.');
      setResolvedRecipient(null);
      return null;
    }

    setLookingUpRecipient(true);
    setLookupError(null);
    try {
      const entry = await resolveTransferRecipient(cleaned);
      if (!entry) {
        setResolvedRecipient(null);
        setLookupError('No matching Kestrel Bank account was found for that handle, email, or account number.');
        return null;
      }
      setResolvedRecipient(entry);
      return entry;
    } catch (err) {
      setResolvedRecipient(null);
      setLookupError(err instanceof Error ? err.message : 'Unable to verify recipient.');
      return null;
    } finally {
      setLookingUpRecipient(false);
    }
  };

  const handlePeerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawalFrozen) {
      onWithdrawalBlocked();
      return;
    }
    if (!peerSourceAccount) {
      onNotify('error', 'Select a source account.');
      return;
    }
    if (peerSourceAccount.status !== 'active') {
      onNotify('error', `${peerSourceAccount.name} is frozen.`);
      return;
    }

    let recipient = resolvedRecipient;
    if (!recipient) {
      recipient = await performRecipientLookup(recipientQuery);
      if (!recipient) return;
    }

    if (recipient.accountId === peerSourceAccount.id) {
      onNotify('error', 'Source and recipient accounts must be different.');
      return;
    }
    if (recipient.status !== 'active') {
      onNotify('error', 'Recipient account is frozen and cannot receive transfers.');
      return;
    }
    if (recipient.currency !== peerSourceAccount.currency) {
      onNotify('error', `Currency mismatch (${peerSourceAccount.currency} vs ${recipient.currency}).`);
      return;
    }

    const cents = parseDollarsToCents(peerAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid positive transfer amount.');
      return;
    }
    if (cents > peerSourceAccount.balanceCents) {
      onNotify('error', 'Insufficient available balance in the selected source account.');
      return;
    }

    setSendingPeer(true);
    try {
      const ref = await executePeerTransfer({
        fromUserId: userId,
        fromUserDisplayName: profile?.displayName ?? 'Kestrel Member',
        fromUserHandle: profile?.handle ?? '@member',
        fromAccountId: peerSourceAccount.id,
        toRecipient: recipient,
        amountCents: cents,
        memo: peerMemo.trim(),
      });
      setPeerAmount('');
      setPeerMemo('');
      setRecipientQuery('');
      setResolvedRecipient(null);
      setLookupError(null);
      onNotify(
        'success',
        `Transferred ${formatCents(cents, peerSourceAccount.currency)} to ${recipient.displayName} (${ref}).`
      );
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Transfer failed.');
      }
    } finally {
      setSendingPeer(false);
    }
  };

  const handleExternalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawalFrozen) {
      onWithdrawalBlocked();
      return;
    }
    const sourceAcc = extSourceAccount;
    if (!sourceAcc) {
      onNotify('error', 'Select a source account.');
      return;
    }
    if (sourceAcc.status !== 'active') {
      onNotify('error', `${sourceAcc.name} is frozen. Select an active account or contact an administrator.`);
      return;
    }
    const cents = parseDollarsToCents(extAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid transfer amount.');
      return;
    }
    if (cents > sourceAcc.balanceCents) {
      onNotify('error', 'Insufficient funds in the selected source account.');
      return;
    }

    const recipientName = selectedBeneficiary?.name ?? customName.trim();
    const trimmedBank = customBank.trim();
    const effectiveBankName = trimmedBank || 'External Bank';
    const recipientDetail = selectedBeneficiary
      ? `${selectedBeneficiary.bankName} ···· ${selectedBeneficiary.accountLast4}`
      : `${effectiveBankName} ···· ${customLast4.trim() || '0000'}`;

    if (!recipientName) {
      onNotify('error', 'Select a saved beneficiary or enter a recipient name.');
      return;
    }

    if (!selectedBeneficiary && saveAsBeneficiary) {
      if (recipientName.length < BLUEPRINT_LIMITS.NAME_MIN) {
        onNotify('error', 'Recipient name must be at least 2 characters to save as a beneficiary.');
        return;
      }
      if (trimmedBank.length === 1) {
        onNotify('error', 'Bank name must be at least 2 characters.');
        return;
      }
      if (!BLUEPRINT_LIMITS.ROUTING_REGEX.test(customRouting.trim())) {
        onNotify('error', 'Enter a valid 9-digit routing number to save beneficiary.');
        return;
      }
      if (!BLUEPRINT_LIMITS.LAST4_REGEX.test(customLast4.trim())) {
        onNotify('error', 'Enter the 4-digit account suffix to save beneficiary.');
        return;
      }
    }

    setSendingExt(true);
    try {
      if (!selectedBeneficiary && saveAsBeneficiary) {
        await createBeneficiary({
          userId,
          name: recipientName,
          bankName: effectiveBankName,
          routingNumber: customRouting.trim(),
          accountLast4: customLast4.trim(),
          accountType: 'checking',
          email: '',
        });
      }

      const ref = await executeExternalTransfer({
        userId,
        accountId: sourceAcc.id,
        recipientName,
        recipientDetail,
        amountCents: cents,
        txType: 'transfer_out',
        category: extCategory,
        memo: extMemo.trim(),
      });

      setExtAmount('');
      setExtMemo('');
      setCustomName('');
      setCustomBank('');
      setCustomRouting('');
      setCustomLast4('');
      setSaveAsBeneficiary(false);
      onNotify(
        'success',
        `Sent ${formatCents(cents, sourceAcc.currency)} to ${recipientName} (${ref}).`
      );
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Transfer failed.');
      }
    } finally {
      setSendingExt(false);
    }
  };

  const handleInternalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(intAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid positive amount.');
      return;
    }
    setSendingInt(true);
    try {
      const ref = await executeInternalTransfer({
        userId,
        fromAccountId: effectiveFromId,
        toAccountId: effectiveToId,
        amountCents: cents,
        memo: intMemo.trim(),
      });
      setIntAmount('');
      setIntMemo('');
      onNotify('success', `Internal transfer completed (${ref}).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Internal transfer failed.');
    } finally {
      setSendingInt(false);
    }
  };

  const handleCreateScheduled = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawalFrozen) {
      onWithdrawalBlocked();
      return;
    }
    const acc = schSourceAccount;
    if (!acc) {
      onNotify('error', 'Select a funding account.');
      return;
    }
    if (acc.status !== 'active') {
      onNotify('error', `${acc.name} is frozen. Select an active funding account or contact an administrator.`);
      return;
    }
    const cents = parseDollarsToCents(schAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid bill amount.');
      return;
    }
    if (schPayee.trim().length < BLUEPRINT_LIMITS.NAME_MIN) {
      onNotify('error', 'Enter a valid payee name (min 2 characters).');
      return;
    }
    if (!BLUEPRINT_LIMITS.DATE_REGEX.test(schDueDate)) {
      onNotify('error', 'Select a valid due date.');
      return;
    }

    setCreatingSch(true);
    try {
      await createScheduledPayment({
        userId,
        accountId: acc.id,
        payeeName: schPayee.trim(),
        category: schCategory,
        amountCents: cents,
        currency: acc.currency,
        cadence: schCadence,
        nextDueDate: schDueDate,
      });
      setSchPayee('');
      setSchAmount('');
      onNotify('success', `Scheduled payment to ${schPayee.trim()} created.`);
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Unable to schedule payment.');
      }
    } finally {
      setCreatingSch(false);
    }
  };

  const handleExecuteScheduledNow = async (sp: ScheduledPayment) => {
    if (withdrawalFrozen) {
      onWithdrawalBlocked();
      return;
    }
    setExecutingId(sp.id);
    try {
      const ref = await executeScheduledPaymentNow(userId, sp.id);
      onNotify(
        'success',
        `Paid ${formatCents(sp.amountCents, sp.currency)} to ${sp.payeeName} (${ref}).`
      );
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Payment execution failed.');
      }
    } finally {
      setExecutingId(null);
    }
  };

  const handleCancelScheduled = async (sp: ScheduledPayment) => {
    setCancellingSchId(sp.id);
    try {
      await cancelScheduledPayment(sp.id);
      onNotify('success', `Cancelled scheduled payment to ${sp.payeeName}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel payment.');
    } finally {
      setCancellingSchId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SegmentedTabs
        layoutId="transferModeTab"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'peer', label: 'Send to User / Account' },
          { id: 'internal', label: 'Internal Sweep' },
          { id: 'external', label: 'External ACH / Wire' },
          {
            id: 'scheduled',
            label: `Scheduled & Bill Pay (${scheduledPayments.filter((s) => s.status === 'scheduled').length})`,
          },
        ]}
      />

      <AnimatePresence mode="wait">
        {mode === 'peer' && (
          <motion.div
            key="mode-peer"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <div className="lg:col-span-7 bg-white border border-slate-200/90 shadow-xs rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900">Transfer Funds to Another Account</h2>
            <p className="text-xs text-slate-500 mt-0.5 mb-5">
              Send money instantly by Kestrel @handle, email address, or 10–12 digit account number
            </p>

            <form onSubmit={handlePeerSubmit} className="space-y-4">
              <div>
                <label htmlFor="peer-source" className="block text-xs font-medium text-slate-700 mb-1.5">
                  From Account
                </label>
                <select
                  id="peer-source"
                  value={effectivePeerSourceId}
                  onChange={(e) => setPeerSourceId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ···· {acc.accountNumber.slice(-4)} ({formatCents(acc.balanceCents, acc.currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="peer-recipient" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Recipient (@handle, Email, or Account Number)
                </label>
                <div className="flex gap-2">
                  <input
                    id="peer-recipient"
                    type="text"
                    required
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value);
                      setResolvedRecipient(null);
                      setLookupError(null);
                    }}
                    placeholder="e.g. @alex, alex@example.com, or 4812345678"
                    className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                  <button
                    type="button"
                    onClick={() => performRecipientLookup(recipientQuery)}
                    disabled={lookingUpRecipient || !recipientQuery.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{lookingUpRecipient ? 'Checking...' : 'Verify'}</span>
                  </button>
                </div>
              </div>

              {lookupError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{lookupError}</span>
                </div>
              )}

              {resolvedRecipient && (
                <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <UserCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {resolvedRecipient.displayName}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        <span className="font-mono">{resolvedRecipient.handle}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{resolvedRecipient.accountName}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono">···· {resolvedRecipient.accountLast4}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{resolvedRecipient.currency}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResolvedRecipient(null);
                      setRecipientQuery('');
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="peer-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Amount ({peerSourceAccount?.currency ?? 'USD'})
                  </label>
                  <input
                    id="peer-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={peerAmount}
                    onChange={(e) => setPeerAmount(e.target.value)}
                    placeholder="250.00"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="peer-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Transfer Memo
                  </label>
                  <input
                    id="peer-memo"
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
                    value={peerMemo}
                    onChange={(e) => setPeerMemo(e.target.value)}
                    placeholder="Optional note for recipient"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              {peerBlockReason && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>{peerBlockReason}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={sendingPeer || lookingUpRecipient || !!peerBlockReason}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>
                  {sendingPeer
                    ? 'Settling Instant Transfer...'
                    : resolvedRecipient
                      ? `Send to ${resolvedRecipient.displayName}`
                      : 'Verify Recipient & Send Funds'}
                </span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Your Receiving Coordinates</h3>
              <p className="text-xs text-slate-500">
                Share your Kestrel handle, email, or account number with counterparties so they can transfer funds directly to you.
              </p>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Kestrel Handle</span>
                  <span className="font-mono font-medium text-slate-900">
                    {profile?.handle ?? '@member'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Email</span>
                  <span className="font-mono text-slate-800 truncate">{profile?.email ?? '—'}</span>
                </div>
              </div>
            </div>

            {accounts.length > 1 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Quick-Select Your Other Accounts</h3>
                <p className="text-xs text-slate-500">
                  Populate an account number directly to test instant account-to-account settlement
                </p>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {accounts
                    .filter((a) => a.id !== effectivePeerSourceId)
                    .map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setRecipientQuery(acc.accountNumber);
                          void performRecipientLookup(acc.accountNumber);
                        }}
                        className="w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{acc.name}</p>
                          <p className="text-xs font-mono text-slate-500">{acc.accountNumber}</p>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-slate-700 shrink-0">
                          {formatCents(acc.balanceCents, acc.currency)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          </motion.div>
        )}

        {mode === 'external' && (
          <motion.div
            key="mode-external"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <div className="lg:col-span-7 bg-white border border-slate-200/90 shadow-xs rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900">Send External Payment</h2>
            <p className="text-xs text-slate-500 mt-0.5 mb-5">
              Initiate an ACH or wire payout to a saved beneficiary or one-time recipient
            </p>

            <form onSubmit={handleExternalSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ext-source" className="block text-xs font-medium text-slate-700 mb-1.5">
                    From Account
                  </label>
                  <select
                    id="ext-source"
                    value={effectiveExtAccountId}
                    onChange={(e) => setExtAccountId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({formatCents(acc.balanceCents, acc.currency)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ext-ben" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Saved Beneficiary
                  </label>
                  <select
                    id="ext-ben"
                    value={selectedBeneficiaryId}
                    onChange={(e) => setSelectedBeneficiaryId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="">Enter one-time recipient...</option>
                    {beneficiaries.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.bankName} ···· {b.accountLast4})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!selectedBeneficiary && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ext-rec-name" className="block text-xs font-medium text-slate-700 mb-1">
                        Recipient Name
                      </label>
                      <input
                        id="ext-rec-name"
                        type="text"
                        required
                        maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Recipient or company"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                    <div>
                      <label htmlFor="ext-rec-bank" className="block text-xs font-medium text-slate-700 mb-1">
                        Bank Name
                      </label>
                      <input
                        id="ext-rec-bank"
                        type="text"
                        maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                        value={customBank}
                        onChange={(e) => setCustomBank(e.target.value)}
                        placeholder="e.g. Mercury / Chase"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ext-rec-rtn" className="block text-xs font-medium text-slate-700 mb-1">
                        Routing Number (9 digits)
                      </label>
                      <input
                        id="ext-rec-rtn"
                        type="text"
                        maxLength={9}
                        value={customRouting}
                        onChange={(e) => setCustomRouting(e.target.value.replace(/\D/g, ''))}
                        placeholder="021000021"
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                    <div>
                      <label htmlFor="ext-rec-last4" className="block text-xs font-medium text-slate-700 mb-1">
                        Account Last 4
                      </label>
                      <input
                        id="ext-rec-last4"
                        type="text"
                        maxLength={4}
                        value={customLast4}
                        onChange={(e) => setCustomLast4(e.target.value.replace(/\D/g, ''))}
                        placeholder="4490"
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsBeneficiary}
                      onChange={(e) => setSaveAsBeneficiary(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span>Save recipient to Beneficiaries directory</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ext-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Amount ({extSourceAccount?.currency ?? 'USD'})
                  </label>
                  <input
                    id="ext-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={extAmount}
                    onChange={(e) => setExtAmount(e.target.value)}
                    placeholder="500.00"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="ext-cat" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Category
                  </label>
                  <select
                    id="ext-cat"
                    value={extCategory}
                    onChange={(e) => setExtCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="Vendor Payment">Vendor Payment</option>
                    <option value="Payroll">Payroll</option>
                    <option value="Cloud & Software">Cloud &amp; Software</option>
                    <option value="Contractors">Contractors</option>
                    <option value="Tax & Legal">Tax &amp; Legal</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ext-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Payment Memo
                </label>
                <input
                  id="ext-memo"
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
                  value={extMemo}
                  onChange={(e) => setExtMemo(e.target.value)}
                  placeholder="Optional reference for recipient"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              {extSourceAccount?.status === 'frozen' && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>{extSourceAccount.name}</strong> is currently frozen. Select an active source account or contact an administrator (
                    <span className="font-mono font-medium">{PRIMARY_ADMIN_EMAIL}</span>).
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  sendingExt ||
                  !extSourceAccount ||
                  extSourceAccount.status === 'frozen'
                }
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>
                  {sendingExt
                    ? 'Executing Transfer...'
                    : extSourceAccount?.status === 'frozen'
                      ? 'Account Frozen — Select Active Account'
                      : 'Authorize & Send Payment'}
                </span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Quick-Select Beneficiaries</h3>
              {selectedBeneficiaryId && (
                <button
                  type="button"
                  onClick={() => setSelectedBeneficiaryId('')}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Clear selection
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Click a verified recipient to populate transfer details (click again to deselect)
            </p>
            {beneficiaries.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                No saved beneficiaries yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {beneficiaries.map((b) => {
                  const isSelected = selectedBeneficiaryId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBeneficiaryId(isSelected ? '' : b.id)}
                      className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50/70' : ''
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{b.name}</p>
                        <p className="text-xs text-slate-500">
                          {b.bankName}
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono">···· {b.accountLast4}</span>
                        </p>
                      </div>
                      <span className="text-xs font-medium text-blue-700 capitalize shrink-0">
                        {isSelected ? 'Selected' : b.accountType}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </motion.div>
        )}

        {mode === 'internal' && (
          <motion.div
            key="mode-internal"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl bg-white border border-slate-200/90 shadow-xs rounded-xl p-6"
          >
          <h2 className="text-base font-semibold text-slate-900">Internal Account Sweep</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-5">
            Move funds instantaneously between your active same-currency Kestrel Bank accounts
          </p>

          <form onSubmit={handleInternalSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="int-from" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Source Account
                </label>
                <select
                  id="int-from"
                  value={effectiveFromId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatCents(acc.balanceCents, acc.currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="int-to" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Destination Account
                </label>
                <select
                  id="int-to"
                  value={effectiveToId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatCents(acc.balanceCents, acc.currency)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="int-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                Transfer Amount ({fromAccount?.currency ?? 'USD'})
              </label>
              <input
                id="int-amount"
                type="text"
                inputMode="decimal"
                required
                value={intAmount}
                onChange={(e) => setIntAmount(e.target.value)}
                placeholder="1000.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="int-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
                Transfer Memo
              </label>
              <input
                id="int-memo"
                type="text"
                maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
                value={intMemo}
                onChange={(e) => setIntMemo(e.target.value)}
                placeholder="e.g. Monthly treasury liquidity sweep"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            {internalTransferBlockReason && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{internalTransferBlockReason}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={sendingInt || !!internalTransferBlockReason}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>
                {accounts.length < 2
                  ? 'Open a Second Account to Transfer Internally'
                  : sendingInt
                    ? 'Settling...'
                    : 'Execute Instant Sweep'}
              </span>
            </button>
          </form>
          </motion.div>
        )}

        {mode === 'scheduled' && (
          <motion.div
            key="mode-scheduled"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <div className="lg:col-span-5 bg-white border border-slate-200/90 shadow-xs rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900">Schedule Bill Payment</h2>
            <p className="text-xs text-slate-500 mt-0.5 mb-5">
              Set up one-time or recurring automatic vendor &amp; utility payouts
            </p>

            <form onSubmit={handleCreateScheduled} className="space-y-4">
              <div>
                <label htmlFor="sch-acc" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Funding Account
                </label>
                <select
                  id="sch-acc"
                  value={effectiveSchAccountId}
                  onChange={(e) => setSchAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sch-payee" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Payee Name
                </label>
                <input
                  id="sch-payee"
                  type="text"
                  required
                  maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                  value={schPayee}
                  onChange={(e) => setSchPayee(e.target.value)}
                  placeholder="e.g. Con Edison or AWS"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sch-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Amount ({schSourceAccount?.currency ?? 'USD'})
                  </label>
                  <input
                    id="sch-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={schAmount}
                    onChange={(e) => setSchAmount(e.target.value)}
                    placeholder="240.00"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="sch-cadence" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Cadence
                  </label>
                  <select
                    id="sch-cadence"
                    value={schCadence}
                    onChange={(e) => setSchCadence(e.target.value as ScheduledCadence)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="once">One-time</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sch-cat" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Category
                  </label>
                  <select
                    id="sch-cat"
                    value={schCategory}
                    onChange={(e) => setSchCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="Utilities">Utilities</option>
                    <option value="Cloud & Software">Cloud &amp; Software</option>
                    <option value="Rent & Facilities">Rent &amp; Facilities</option>
                    <option value="Insurance">Insurance</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="sch-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Next Due Date
                  </label>
                  <input
                    id="sch-date"
                    type="date"
                    required
                    value={schDueDate}
                    onChange={(e) => setSchDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              {schSourceAccount?.status === 'frozen' && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>{schSourceAccount.name}</strong> is currently frozen. Select an active funding account or contact an administrator.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={creatingSch || !schSourceAccount || schSourceAccount.status === 'frozen'}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <CalendarClock className="w-4 h-4" />
                <span>
                  {schSourceAccount?.status === 'frozen'
                    ? 'Account Frozen — Select Active Account'
                    : creatingSch
                      ? 'Saving...'
                      : 'Schedule Payment'}
                </span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">Upcoming &amp; Recurring Bills</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Execute a bill immediately or cancel future runs
              </p>
            </div>
            {scheduledPayments.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No scheduled payments configured.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {scheduledPayments.map((sp) => (
                  <div
                    key={sp.id}
                    className="px-6 py-4 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{sp.payeeName}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="capitalize">{sp.cadence}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>Due {sp.nextDueDate}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{sp.category}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                        {formatCents(sp.amountCents, sp.currency)}
                      </span>
                      {sp.status === 'scheduled' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleExecuteScheduledNow(sp)}
                            disabled={executingId === sp.id}
                            title="Execute payment now"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{executingId === sp.id ? 'Paying...' : 'Pay Now'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelScheduled(sp)}
                            disabled={cancellingSchId === sp.id}
                            aria-label="Cancel scheduled payment"
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded-md cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500 capitalize">{sp.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
