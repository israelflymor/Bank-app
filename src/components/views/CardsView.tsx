import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CreditCard, Lock, Plus, SlidersHorizontal, ShoppingBag, Unlock } from 'lucide-react';
import { formatCents, parseDollarsToCents } from '../../lib/format';
import {
  BLUEPRINT_LIMITS,
  WITHDRAWAL_FROZEN_MESSAGE,
  isWithdrawalAccessFrozen,
  type BankAccount,
  type CardNetwork,
  type UserProfile,
  type VirtualCard,
} from '../../types/banking';
import {
  issueVirtualCard,
  recordCardPurchase,
  toggleCardStatus,
  updateCardLimit,
} from '../../services/bankingService';
import { Modal } from '../ui/Modal';

interface CardsViewProps {
  userId: string;
  profile: UserProfile | null;
  accounts: BankAccount[];
  cards: VirtualCard[];
  onWithdrawalBlocked: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const CardsView: React.FC<CardsViewProps> = ({
  userId,
  profile,
  accounts,
  cards,
  onWithdrawalBlocked,
  onNotify,
}) => {
  const [issueOpen, setIssueOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [network, setNetwork] = useState<CardNetwork>('Visa');
  const [limitInput, setLimitInput] = useState('2500');
  const [issuing, setIssuing] = useState(false);

  const [limitModalCard, setLimitModalCard] = useState<VirtualCard | null>(null);
  const [nextLimitInput, setNextLimitInput] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [togglingCardId, setTogglingCardId] = useState<string | null>(null);

  const [spendModalCard, setSpendModalCard] = useState<VirtualCard | null>(null);
  const [merchantName, setMerchantName] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [spendCategory, setSpendCategory] = useState('Cloud & Software');
  const [authorizingSpend, setAuthorizingSpend] = useState(false);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const effectiveAccountId = accountId || accounts[0]?.id || '';
  const issueLinkedAcc = accountMap.get(effectiveAccountId);
  const spendLinkedAcc = spendModalCard ? accountMap.get(spendModalCard.accountId) : undefined;
  const withdrawalFrozen = isWithdrawalAccessFrozen(profile);

  const handleIssueCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveAccountId) {
      onNotify('error', 'Select a funding account first.');
      return;
    }
    const limitCents = parseDollarsToCents(limitInput);
    if (
      !limitCents ||
      limitCents < BLUEPRINT_LIMITS.MIN_CARD_LIMIT_CENTS ||
      limitCents > BLUEPRINT_LIMITS.MAX_CARD_LIMIT_CENTS
    ) {
      onNotify('error', 'Monthly limit must be between $10.00 and $10,000,000.00.');
      return;
    }
    if (label.trim().length < BLUEPRINT_LIMITS.NAME_MIN) {
      onNotify('error', 'Enter a card label (min 2 characters).');
      return;
    }

    setIssuing(true);
    try {
      await issueVirtualCard({
        userId,
        accountId: effectiveAccountId,
        label: label.trim(),
        holderName: profile?.displayName ?? 'Account Holder',
        network,
        monthlyLimitCents: limitCents,
      });
      setLabel('');
      setIssueOpen(false);
      onNotify('success', 'Issued new virtual debit card.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to issue card.');
    } finally {
      setIssuing(false);
    }
  };

  const handleToggleFreeze = async (card: VirtualCard) => {
    const nextStatus = card.status === 'active' ? 'frozen' : 'active';
    setTogglingCardId(card.id);
    try {
      await toggleCardStatus(card.id, nextStatus);
      onNotify('success', `${card.label} (•••• ${card.last4}) is now ${nextStatus}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update card status.');
    } finally {
      setTogglingCardId(null);
    }
  };

  const handleSaveLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitModalCard) return;
    const cents = parseDollarsToCents(nextLimitInput);
    if (
      !cents ||
      cents < BLUEPRINT_LIMITS.MIN_CARD_LIMIT_CENTS ||
      cents > BLUEPRINT_LIMITS.MAX_CARD_LIMIT_CENTS
    ) {
      onNotify('error', 'Enter a monthly limit between $10.00 and $10,000,000.00.');
      return;
    }
    setSavingLimit(true);
    try {
      await updateCardLimit(limitModalCard.id, cents);
      setLimitModalCard(null);
      onNotify('success', 'Card monthly limit updated.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update card limit.');
    } finally {
      setSavingLimit(false);
    }
  };

  const handleAuthorizePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spendModalCard) return;
    if (withdrawalFrozen) {
      setSpendModalCard(null);
      onWithdrawalBlocked();
      return;
    }
    if (!merchantName.trim()) {
      onNotify('error', 'Enter a valid merchant name.');
      return;
    }
    if (spendLinkedAcc?.status === 'frozen') {
      onNotify('error', 'Linked bank account is frozen. Contact an administrator before charging this card.');
      return;
    }
    const cents = parseDollarsToCents(spendAmount);
    if (!cents || cents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
      onNotify('error', 'Enter a valid purchase amount.');
      return;
    }
    setAuthorizingSpend(true);
    try {
      const ref = await recordCardPurchase({
        userId,
        cardId: spendModalCard.id,
        merchantName: merchantName.trim(),
        category: spendCategory,
        amountCents: cents,
      });
      setSpendModalCard(null);
      setMerchantName('');
      setSpendAmount('');
      onNotify('success', `Authorized card charge (${ref}).`);
    } catch (err) {
      if (err instanceof Error && err.message === WITHDRAWAL_FROZEN_MESSAGE) {
        setSpendModalCard(null);
        onWithdrawalBlocked();
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Card authorization declined.');
      }
    } finally {
      setAuthorizingSpend(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Virtual &amp; Commercial Debit Cards
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Govern monthly spending caps, freeze cards instantaneously, and track linked account draws
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIssueOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Issue Virtual Card</span>
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <CreditCard className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-900 mb-1">No cards issued yet</p>
          <p className="text-xs text-slate-500 mb-4">
            Issue a virtual Visa or Mastercard linked to any active deposit account.
          </p>
          <button
            type="button"
            onClick={() => setIssueOpen(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            Issue First Card
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {cards.map((card) => {
            const linkedAcc = accountMap.get(card.accountId);
            const curr = linkedAcc?.currency ?? 'USD';
            const isFrozen = card.status === 'frozen';
            const pct = Math.min(
              100,
              Math.round((card.spentThisMonthCents / card.monthlyLimitCents) * 100)
            );

            return (
              <motion.div
                key={card.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 flex flex-col justify-between gap-5"
              >
                {/* Physical/Virtual Card Face */}
                <div
                  className={`relative overflow-hidden rounded-lg p-5 text-white flex flex-col justify-between min-h-[172px] ${
                    isFrozen
                      ? 'bg-slate-600'
                      : card.network === 'Visa'
                        ? 'bg-gradient-to-br from-[#0B162C] via-[#10203F] to-slate-900'
                        : 'bg-gradient-to-br from-[#0B162C] via-[#132952] to-blue-950'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-300">Kestrel Bank</span>
                    <span className="text-xs font-semibold tracking-wider uppercase text-slate-200">
                      {card.network}
                    </span>
                  </div>

                  <div>
                    <p className="text-lg font-mono tracking-widest tabular-nums">
                      •••• •••• •••• {card.last4}
                    </p>
                  </div>

                  <div className="flex items-end justify-between text-xs">
                    <div>
                      <p className="text-slate-400 text-[11px]">Cardholder</p>
                      <p className="font-medium text-slate-100 mt-0.5">{card.holderName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-400 text-[11px]">Exp · Status</p>
                      <p className="font-mono mt-0.5">
                        {card.expiry} · {isFrozen ? 'FROZEN' : 'ACTIVE'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Controls & Spend Progress */}
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{card.label}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Linked to {linkedAcc?.name ?? 'Account'}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isFrozen ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {isFrozen ? 'Frozen' : 'Active'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-500">Monthly Spend</span>
                      <span className="font-mono tabular-nums text-slate-900 font-medium">
                        {formatCents(card.spentThisMonthCents, curr)} /{' '}
                        {formatCents(card.monthlyLimitCents, curr)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ width: `${pct}%` }}
                        className={`h-full origin-left rounded-full ${
                          pct >= 90 ? 'bg-red-600' : 'bg-blue-700'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleFreeze(card)}
                      disabled={togglingCardId === card.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      {isFrozen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{isFrozen ? 'Unfreeze' : 'Freeze'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLimitModalCard(card);
                        setNextLimitInput((card.monthlyLimitCents / 100).toFixed(2));
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Limit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpendModalCard(card)}
                      disabled={isFrozen}
                      title={
                        isFrozen
                          ? 'Unfreeze card to authorize a charge'
                          : 'Simulate card purchase'
                      }
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{isFrozen ? 'Card Frozen' : 'Charge'}</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Issue Card Modal */}
      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Issue Virtual Debit Card"
        subtitle="Create a dedicated card with an enforceable monthly spend limit"
      >
        <form onSubmit={handleIssueCard} className="space-y-4">
          <div>
            <label htmlFor="card-label" className="block text-xs font-medium text-slate-700 mb-1.5">
              Card Label
            </label>
            <input
              id="card-label"
              type="text"
              required
              maxLength={BLUEPRINT_LIMITS.CARD_LABEL_MAX}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Marketing Ads or Travel"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="card-acc" className="block text-xs font-medium text-slate-700 mb-1.5">
                Funding Account
              </label>
              <select
                id="card-acc"
                value={effectiveAccountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="card-net" className="block text-xs font-medium text-slate-700 mb-1.5">
                Network
              </label>
              <select
                id="card-net"
                value={network}
                onChange={(e) => setNetwork(e.target.value as CardNetwork)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="Visa">Visa</option>
                <option value="Mastercard">Mastercard</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="card-limit" className="block text-xs font-medium text-slate-700 mb-1.5">
              Monthly Spend Limit ({issueLinkedAcc?.currency ?? 'USD'})
            </label>
            <input
              id="card-limit"
              type="text"
              inputMode="decimal"
              required
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setIssueOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issuing}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              {issuing ? 'Issuing...' : 'Issue Card'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Limit Modal */}
      <Modal
        open={!!limitModalCard}
        onClose={() => setLimitModalCard(null)}
        title="Update Monthly Spend Limit"
        subtitle={limitModalCard ? `${limitModalCard.label} (•••• ${limitModalCard.last4})` : undefined}
      >
        <form onSubmit={handleSaveLimit} className="space-y-4">
          <div>
            <label htmlFor="edit-limit" className="block text-xs font-medium text-slate-700 mb-1.5">
              New Monthly Limit ({limitModalCard ? accountMap.get(limitModalCard.accountId)?.currency ?? 'USD' : 'USD'})
            </label>
            <input
              id="edit-limit"
              type="text"
              inputMode="decimal"
              required
              value={nextLimitInput}
              onChange={(e) => setNextLimitInput(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setLimitModalCard(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingLimit}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {savingLimit ? 'Saving...' : 'Save Limit'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Card Purchase Modal */}
      <Modal
        open={!!spendModalCard}
        onClose={() => setSpendModalCard(null)}
        title="Authorize Card Purchase"
        subtitle={spendModalCard ? `${spendModalCard.network} •••• ${spendModalCard.last4}` : undefined}
      >
        <form onSubmit={handleAuthorizePurchase} className="space-y-4">
          <div>
            <label htmlFor="spend-merchant" className="block text-xs font-medium text-slate-700 mb-1.5">
              Merchant Name
            </label>
            <input
              id="spend-merchant"
              type="text"
              required
              maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder="e.g. Figma or United Airlines"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="spend-amt" className="block text-xs font-medium text-slate-700 mb-1.5">
                Amount ({spendLinkedAcc?.currency ?? 'USD'})
              </label>
              <input
                id="spend-amt"
                type="text"
                inputMode="decimal"
                required
                value={spendAmount}
                onChange={(e) => setSpendAmount(e.target.value)}
                placeholder="48.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label htmlFor="spend-cat" className="block text-xs font-medium text-slate-700 mb-1.5">
                Category
              </label>
              <select
                id="spend-cat"
                value={spendCategory}
                onChange={(e) => setSpendCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="Cloud & Software">Cloud &amp; Software</option>
                <option value="Travel">Travel</option>
                <option value="Meals & Dining">Meals &amp; Dining</option>
                <option value="Supplies">Supplies</option>
              </select>
            </div>
          </div>
          {spendLinkedAcc?.status === 'frozen' && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                Linked account <strong>{spendLinkedAcc.name}</strong> is frozen. Contact an administrator before authorizing a purchase.
              </span>
            </div>
          )}
          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setSpendModalCard(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={authorizingSpend || spendLinkedAcc?.status === 'frozen'}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {authorizingSpend ? 'Authorizing...' : 'Authorize Charge'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
