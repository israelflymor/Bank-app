import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowDownLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Link2,
  Plus,
  QrCode,
  XCircle,
} from 'lucide-react';
import { formatCents, formatDateShort, parseDollarsToCents } from '../../lib/format';
import {
  BLUEPRINT_LIMITS,
  PRIMARY_ADMIN_EMAIL,
  type BankAccount,
  type PaymentRequest,
  type TxType,
  type UserProfile,
} from '../../types/banking';
import {
  cancelPaymentRequest,
  createPaymentRequest,
  receiveFundsDeposit,
  settlePaymentRequest,
} from '../../services/bankingService';
import { Modal } from '../ui/Modal';
import { SegmentedTabs } from '../ui/SegmentedTabs';

export type ReceiveTab = 'direct' | 'requests';

interface ReceiveFundsViewProps {
  userId: string;
  profile: UserProfile | null;
  accounts: BankAccount[];
  paymentRequests: PaymentRequest[];
  activeTab: ReceiveTab;
  onTabChange: (tab: ReceiveTab) => void;
  preselectedRequestId?: string | null;
  requestsLoaded?: boolean;
  onClearPreselectedRequest?: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const ReceiveFundsView: React.FC<ReceiveFundsViewProps> = ({
  userId,
  profile,
  accounts,
  paymentRequests,
  activeTab,
  onTabChange,
  preselectedRequestId,
  requestsLoaded,
  onClearPreselectedRequest,
  onNotify,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [revealNumber, setRevealNumber] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inbound Deposit Form
  const [senderName, setSenderName] = useState('');
  const [senderDetail, setSenderDetail] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [depositMethod, setDepositMethod] = useState<
    Extract<TxType, 'deposit' | 'wire_in' | 'payment_received'>
  >('payment_received');
  const [depositCategory, setDepositCategory] = useState('Client Invoice');
  const [depositMemo, setDepositMemo] = useState('');
  const [clearAsPending, setClearAsPending] = useState(false);
  const [depositing, setDepositing] = useState(false);

  // Payment Request Modal & State
  const [createReqOpen, setCreateReqOpen] = useState(false);
  const [reqTitle, setReqTitle] = useState('');
  const [reqPayerName, setReqPayerName] = useState('');
  const [reqPayerEmail, setReqPayerEmail] = useState('');
  const [reqAmount, setReqAmount] = useState('');
  const [reqMemo, setReqMemo] = useState('');
  const [reqAccountId, setReqAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [creatingReq, setCreatingReq] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [previewReq, setPreviewReq] = useState<PaymentRequest | null>(null);

  useEffect(() => {
    if (!preselectedRequestId || !requestsLoaded) return;
    const match = paymentRequests.find((r) => r.id === preselectedRequestId);
    onTabChange('requests');
    if (match) {
      setPreviewReq(match);
    } else {
      onNotify('error', 'The requested payment link could not be found in your workspace.');
    }
    onClearPreselectedRequest?.();
  }, [preselectedRequestId, requestsLoaded, paymentRequests, onTabChange, onClearPreselectedRequest, onNotify]);

  const livePreviewReq = useMemo(
    () => (previewReq ? paymentRequests.find((r) => r.id === previewReq.id) ?? previewReq : null),
    [previewReq, paymentRequests]
  );

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? accounts[0],
    [accounts, selectedAccountId]
  );

  const effectiveReqAccountId = reqAccountId || accounts[0]?.id || '';

  const copyText = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      onNotify('success', `Copied ${label} to clipboard.`);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      onNotify('error', 'Unable to copy to clipboard.');
    }
  };

  const handleReceiveDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAccount) {
      onNotify('error', 'Select a destination account first.');
      return;
    }
    const cents = parseDollarsToCents(amountInput);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid positive amount up to $100,000,000.00.');
      return;
    }
    if (!senderName.trim()) {
      onNotify('error', 'Enter the sender or payer name.');
      return;
    }

    setDepositing(true);
    try {
      const ref = await receiveFundsDeposit({
        userId,
        accountId: activeAccount.id,
        amountCents: cents,
        senderName: senderName.trim(),
        senderDetail: senderDetail.trim() || 'ACH Inbound Clearing',
        txType: depositMethod,
        category: depositCategory,
        memo: depositMemo.trim(),
        pendingOnly: clearAsPending,
      });
      setSenderName('');
      setSenderDetail('');
      setAmountInput('');
      setDepositMemo('');
      onNotify(
        'success',
        clearAsPending
          ? `Recorded pending inbound deposit (${ref}). Settle it anytime from the Ledger.`
          : `Credited ${formatCents(cents, activeAccount.currency)} to ${activeAccount.name} (${ref}).`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Deposit failed.');
    } finally {
      setDepositing(false);
    }
  };

  const handleCreatePaymentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAcc = accounts.find((a) => a.id === effectiveReqAccountId) ?? accounts[0];
    if (!targetAcc) {
      onNotify('error', 'No active account found.');
      return;
    }
    const cents = parseDollarsToCents(reqAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid positive request amount.');
      return;
    }
    if (reqTitle.trim().length < BLUEPRINT_LIMITS.TITLE_MIN) {
      onNotify('error', 'Enter an invoice or request title (min 2 characters).');
      return;
    }
    if (!reqPayerName.trim()) {
      onNotify('error', 'Enter the payer name.');
      return;
    }

    setCreatingReq(true);
    try {
      await createPaymentRequest({
        userId,
        accountId: targetAcc.id,
        title: reqTitle.trim(),
        payerName: reqPayerName.trim(),
        payerEmail: reqPayerEmail.trim(),
        amountCents: cents,
        currency: targetAcc.currency,
        memo: reqMemo.trim(),
      });
      setReqTitle('');
      setReqPayerName('');
      setReqPayerEmail('');
      setReqAmount('');
      setReqMemo('');
      setCreateReqOpen(false);
      onNotify('success', 'Payment request created and ready to share.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create payment request.');
    } finally {
      setCreatingReq(false);
    }
  };

  const handleSettle = async (req: PaymentRequest) => {
    setSettlingId(req.id);
    try {
      const ref = await settlePaymentRequest({ userId, requestId: req.id });
      onNotify(
        'success',
        `Payment settled: ${formatCents(req.amountCents, req.currency)} credited (${ref}).`
      );
      if (previewReq?.id === req.id) setPreviewReq(null);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to settle payment request.');
    } finally {
      setSettlingId(null);
    }
  };

  const handleCancelRequest = async (req: PaymentRequest) => {
    setCancellingId(req.id);
    try {
      await cancelPaymentRequest(req.id);
      onNotify('success', `Cancelled request ${req.referenceCode}.`);
      if (previewReq?.id === req.id) setPreviewReq(null);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel request.');
    } finally {
      setCancellingId(null);
    }
  };

  const buildShareLink = (req: PaymentRequest) =>
    `${window.location.origin}/?payRequest=${encodeURIComponent(req.id)}&ref=${encodeURIComponent(req.referenceCode)}`;

  const qrPayload = activeAccount
    ? `kestrel://receive?handle=${encodeURIComponent(profile?.handle ?? '@member')}&routing=${activeAccount.routingNumber}&acct=${activeAccount.accountNumber.slice(-4)}&curr=${activeAccount.currency}`
    : '';

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SegmentedTabs
          layoutId="receiveFundsTab"
          value={activeTab}
          onChange={onTabChange}
          options={[
            { id: 'direct', label: 'Account Routing & Inbound Deposit' },
            {
              id: 'requests',
              label: `Payment Requests & Invoices (${paymentRequests.filter((r) => r.status === 'pending').length})`,
            },
          ]}
        />

        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => setCreateReqOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Payment Request</span>
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'direct' ? (
          <motion.div
            key="receive-direct"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* Left: Routing Credentials + QR */}
            <div className="lg:col-span-6 bg-white border border-slate-200/90 shadow-xs rounded-xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Receiving Account Credentials
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Share these details for ACH direct deposits, domestic Fedwire, or international IBAN transfers
                </p>
              </div>
              <select
                aria-label="Select receiving account"
                value={activeAccount?.id ?? ''}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-700"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency})
                  </option>
                ))}
              </select>
            </div>

            {activeAccount && (
              <>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs text-slate-500">Beneficiary Name &amp; Handle</p>
                      <p className="text-sm font-medium text-slate-900 mt-0.5">
                        {profile?.displayName ?? 'Account Holder'}
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-mono text-blue-700">{profile?.handle ?? '@member'}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText('handle', profile?.handle ?? '@member', 'peer handle')
                      }
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                      aria-label="Copy handle"
                    >
                      {copiedKey === 'handle' ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs text-slate-500">Routine / Routing Number (Login, ACH &amp; Fedwire)</p>
                      <p className="text-sm font-medium text-slate-900 font-mono tabular-nums mt-0.5">
                        {activeAccount.routingNumber}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText('routing', activeAccount.routingNumber, 'routing number')
                      }
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                      aria-label="Copy routing number"
                    >
                      {copiedKey === 'routing' ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs text-slate-500">Account Number</p>
                      <p className="text-sm font-medium text-slate-900 font-mono tabular-nums mt-0.5">
                        {revealNumber
                          ? activeAccount.accountNumber
                          : `••••••${activeAccount.accountNumber.slice(-4)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRevealNumber((v) => !v)}
                        className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                        aria-label={revealNumber ? 'Hide account number' : 'Show account number'}
                      >
                        {revealNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copyText('acct', activeAccount.accountNumber, 'account number')
                        }
                        className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                        aria-label="Copy account number"
                      >
                        {copiedKey === 'acct' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">IBAN / SWIFT Code (KSTLUS33)</p>
                      <p className="text-xs font-medium text-slate-900 font-mono truncate mt-0.5">
                        {activeAccount.iban}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText('iban', activeAccount.iban, 'IBAN')}
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer shrink-0"
                      aria-label="Copy IBAN"
                    >
                      {copiedKey === 'iban' ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* QR Receive Strip */}
                <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="bg-white p-2.5 border border-slate-200 rounded-lg shrink-0">
                    <QRCodeSVG value={qrPayload} size={96} level="M" />
                  </div>
                  <div className="space-y-2 text-center sm:text-left">
                    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800">
                      <QrCode className="w-3.5 h-3.5 text-blue-700" />
                      <span>Instant Scan-to-Pay QR</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Counterparties can scan this code to populate your routing credentials and credit{' '}
                      <span className="font-medium text-slate-900">{activeAccount.name}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'full-instr',
                          `Bank: Kestrel Bank\nAccount Name: ${profile?.displayName ?? 'Member'}\nRouting: ${activeAccount.routingNumber}\nAccount: ${activeAccount.accountNumber}\nIBAN: ${activeAccount.iban}\nSWIFT: KSTLUS33`,
                          'wire instructions'
                        )
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Full Wire Instructions</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right: Record / Receive Inbound Funds */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-900">
                Receive Inbound Funds
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Accept a direct deposit, inbound wire, client payment, or mobile check into your selected account
              </p>
            </div>

            <form onSubmit={handleReceiveDeposit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dep-account" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Destination Account
                  </label>
                  <select
                    id="dep-account"
                    value={activeAccount?.id ?? ''}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
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
                  <label htmlFor="dep-method" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Settlement Rail
                  </label>
                  <select
                    id="dep-method"
                    value={depositMethod}
                    onChange={(e) =>
                      setDepositMethod(
                        e.target.value as Extract<TxType, 'deposit' | 'wire_in' | 'payment_received'>
                      )
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="payment_received">Client / Peer Payment</option>
                    <option value="deposit">ACH Direct Deposit / Check</option>
                    <option value="wire_in">Fedwire / SWIFT Inbound</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dep-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Amount ({activeAccount?.currency ?? 'USD'})
                  </label>
                  <input
                    id="dep-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="2500.00"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label htmlFor="dep-category" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Ledger Category
                  </label>
                  <select
                    id="dep-category"
                    value={depositCategory}
                    onChange={(e) => setDepositCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    <option value="Client Invoice">Client Invoice</option>
                    <option value="Direct Deposit">Direct Deposit</option>
                    <option value="Funding Transfer">Funding Transfer</option>
                    <option value="Reimbursement">Reimbursement</option>
                    <option value="Treasury Yield">Treasury Yield</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dep-sender" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Sender / Payer Name
                  </label>
                  <input
                    id="dep-sender"
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="e.g. Stripe Payouts or Acme Corp"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label htmlFor="dep-detail" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Originating Bank / Reference
                  </label>
                  <input
                    id="dep-detail"
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.EMAIL_MAX}
                    value={senderDetail}
                    onChange={(e) => setSenderDetail(e.target.value)}
                    placeholder="e.g. Chase Commercial ···· 1920"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dep-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Memo / Remittance Note
                </label>
                <input
                  id="dep-memo"
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
                  value={depositMemo}
                  onChange={(e) => setDepositMemo(e.target.value)}
                  placeholder="Optional invoice number or remittance details"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={clearAsPending}
                  onChange={(e) => setClearAsPending(e.target.checked)}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Hold as pending clearing (credit available balance upon manual settlement)</span>
              </label>

              {activeAccount?.status === 'frozen' && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>{activeAccount.name}</strong> is currently frozen. Select an active account or contact an administrator (
                    <span className="font-mono font-medium">{PRIMARY_ADMIN_EMAIL}</span>) before receiving inbound funds.
                  </span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={depositing || !activeAccount || activeAccount.status === 'frozen'}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>
                    {depositing
                      ? 'Processing Settlement...'
                      : activeAccount?.status === 'frozen'
                        ? 'Account Frozen — Select Active Account'
                        : clearAsPending
                          ? 'Record Pending Inbound Deposit'
                          : 'Receive & Credit Account'}
                  </span>
                </button>
              </div>
            </form>
            </div>
          </motion.div>
        ) : (
          /* Payment Requests & Invoices Tab */
          <motion.div
            key="receive-requests"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-slate-200/90 shadow-xs rounded-xl overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Payment Requests &amp; Invoices
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Issue itemized requests with QR codes and settle funds directly into your designated account
              </p>
            </div>
          </div>

          {paymentRequests.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-900 mb-1">No payment requests yet</p>
              <p className="text-xs text-slate-500 mb-4">
                Create a shareable payment request or client invoice to collect funds.
              </p>
              <button
                type="button"
                onClick={() => setCreateReqOpen(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Create First Request
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-6">Invoice / Request</th>
                    <th className="py-2.5 px-4">Payer</th>
                    <th className="py-2.5 px-4">Created</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paymentRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-6">
                        <p className="font-medium text-slate-900">{req.title}</p>
                        <p className="text-xs text-slate-500 font-mono">{req.referenceCode}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-slate-900">{req.payerName}</p>
                        <p className="text-xs text-slate-500">{req.payerEmail || 'Direct link'}</p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                        {formatDateShort(req.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            req.status === 'paid'
                              ? 'text-emerald-700 font-medium'
                              : req.status === 'pending'
                                ? 'text-amber-700 font-medium'
                                : 'text-slate-500'
                          }
                        >
                          {req.status === 'paid'
                            ? 'Paid'
                            : req.status === 'pending'
                              ? 'Pending'
                              : 'Cancelled'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatCents(req.amountCents, req.currency)}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewReq(req)}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            QR / Share
                          </button>
                          {req.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSettle(req)}
                                disabled={settlingId === req.id}
                                className="px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-60"
                              >
                                {settlingId === req.id ? 'Settling...' : 'Mark Paid'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelRequest(req)}
                                disabled={cancellingId === req.id}
                                aria-label="Cancel request"
                                className="p-1.5 text-slate-400 hover:text-red-700 rounded-md cursor-pointer disabled:opacity-50"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Payment Request Modal */}
      <Modal
        open={createReqOpen}
        onClose={() => setCreateReqOpen(false)}
        title="New Payment Request"
        subtitle="Generate an invoice request and shareable QR link to receive funds"
      >
        <form onSubmit={handleCreatePaymentRequest} className="space-y-4">
          <div>
            <label htmlFor="req-title" className="block text-xs font-medium text-slate-700 mb-1.5">
              Request / Invoice Title
            </label>
            <input
              id="req-title"
              type="text"
              required
              minLength={2}
              maxLength={BLUEPRINT_LIMITS.TITLE_MAX}
              value={reqTitle}
              onChange={(e) => setReqTitle(e.target.value)}
              placeholder="e.g. Invoice #1045 — Q4 Advisory"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="req-payer" className="block text-xs font-medium text-slate-700 mb-1.5">
                Payer Name
              </label>
              <input
                id="req-payer"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                value={reqPayerName}
                onChange={(e) => setReqPayerName(e.target.value)}
                placeholder="Client or counterparty"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="req-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Payer Email (optional)
              </label>
              <input
                id="req-email"
                type="email"
                maxLength={BLUEPRINT_LIMITS.EMAIL_MAX}
                value={reqPayerEmail}
                onChange={(e) => setReqPayerEmail(e.target.value)}
                placeholder="ap@client.com"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="req-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                Amount
              </label>
              <input
                id="req-amount"
                type="text"
                inputMode="decimal"
                required
                value={reqAmount}
                onChange={(e) => setReqAmount(e.target.value)}
                placeholder="1250.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="req-account" className="block text-xs font-medium text-slate-700 mb-1.5">
                Deposit Into Account
              </label>
              <select
                id="req-account"
                value={effectiveReqAccountId}
                onChange={(e) => setReqAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="req-memo" className="block text-xs font-medium text-slate-700 mb-1.5">
              Memo / Terms
            </label>
            <input
              id="req-memo"
              type="text"
              maxLength={BLUEPRINT_LIMITS.MEMO_MAX}
              value={reqMemo}
              onChange={(e) => setReqMemo(e.target.value)}
              placeholder="Due upon receipt"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setCreateReqOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingReq}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {creatingReq ? 'Creating...' : 'Create Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Preview & Share Request Modal */}
      <Modal
        open={!!livePreviewReq}
        onClose={() => setPreviewReq(null)}
        title={livePreviewReq?.title ?? 'Payment Request'}
        subtitle={livePreviewReq ? `Reference ${livePreviewReq.referenceCode}` : undefined}
      >
        {livePreviewReq && (
          <div className="space-y-5">
            <div className="flex flex-col items-center p-5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="bg-white p-3 border border-slate-200 rounded-lg mb-3">
                <QRCodeSVG value={buildShareLink(livePreviewReq)} size={136} level="M" />
              </div>
              <p className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                {formatCents(livePreviewReq.amountCents, livePreviewReq.currency)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Requested from {livePreviewReq.payerName}
              </p>
              {livePreviewReq.status !== 'pending' && (
                <span className="mt-2 text-xs font-medium capitalize text-slate-600">
                  Status: {livePreviewReq.status}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={buildShareLink(livePreviewReq)}
                aria-label="Shareable payment link"
                className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              />
              <button
                type="button"
                onClick={() => copyText('share-link', buildShareLink(livePreviewReq), 'payment link')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Copy Link</span>
              </button>
            </div>

            {livePreviewReq.status === 'pending' && (
              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleCancelRequest(livePreviewReq)}
                  disabled={cancellingId === livePreviewReq.id}
                  className="px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {cancellingId === livePreviewReq.id ? 'Cancelling...' : 'Cancel Request'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSettle(livePreviewReq)}
                  disabled={settlingId === livePreviewReq.id}
                  className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {settlingId === livePreviewReq.id ? 'Settling...' : 'Mark Paid & Credit Account'}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
