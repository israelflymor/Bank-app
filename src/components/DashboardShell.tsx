import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  LayoutDashboard,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
  AlertCircle,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { timestampToMs } from '../lib/format';
import {
  bootstrapUserWorkspace,
  checkIsAdmin,
  ensureSeededMembers,
  NEW_CREDENTIALS_STORAGE_KEY,
  type GeneratedMemberCredentials,
} from '../services/bankingService';
import {
  PRIMARY_ADMIN_EMAIL,
  WITHDRAWAL_FROZEN_MESSAGE,
  type ActiveNavSection,
  type BankAccount,
  type Beneficiary,
  type LedgerTransaction,
  type PaymentRequest,
  type ScheduledPayment,
  type UserProfile,
  type VirtualCard,
} from '../types/banking';
import { Modal } from './ui/Modal';
import { OverviewView } from './views/OverviewView';
import { ReceiveFundsView } from './views/ReceiveFundsView';
import { TransferFunds } from './views/TransferFunds';
import { LedgerView } from './views/LedgerView';
import { CardsView } from './views/CardsView';
import { BeneficiariesView } from './views/BeneficiariesView';
import { AdminConsoleView } from './views/AdminConsoleView';

interface DashboardShellProps {
  user: User;
}

const MEMBER_NAV_ITEMS: { id: ActiveNavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'receive', label: 'Receive Funds', icon: ArrowDownLeft },
  { id: 'transfers', label: 'Transfers & Pay', icon: ArrowLeftRight },
  { id: 'ledger', label: 'Ledger', icon: ListOrdered },
  { id: 'cards', label: 'Cards & Limits', icon: CreditCard },
  { id: 'beneficiaries', label: 'Beneficiaries', icon: Users },
];

export const DashboardShell: React.FC<DashboardShellProps> = ({ user }) => {
  const [activeSection, setActiveSection] = useState<ActiveNavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(
    () => Boolean(user.emailVerified && user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase())
  );

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [scheduledPayments, setScheduledPayments] = useState<ScheduledPayment[]>([]);

  const [preselectedBeneficiaryId, setPreselectedBeneficiaryId] = useState<string | null>(null);
  const [receiveTab, setReceiveTab] = useState<'direct' | 'requests'>('direct');
  const [preselectedRequestId, setPreselectedRequestId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('payRequest');
  });
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [preselectedLedgerAccountId, setPreselectedLedgerAccountId] = useState<string | null>(null);
  const [preselectedLedgerTxId, setPreselectedLedgerTxId] = useState<string | null>(null);
  const [withdrawalBlockedOpen, setWithdrawalBlockedOpen] = useState(false);
  const [newCredentials, setNewCredentials] = useState<GeneratedMemberCredentials | null>(null);
  const [credCopied, setCredCopied] = useState<'acct' | 'routine' | 'both' | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  const handleWithdrawalBlocked = useCallback(() => {
    setWithdrawalBlockedOpen(true);
  }, []);

  const copyCredentialValue = async (key: 'acct' | 'routine' | 'both', value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCredCopied(key);
      notify('success', `Copied ${label} to clipboard.`);
      setTimeout(() => setCredCopied(null), 1800);
    } catch {
      notify('error', 'Unable to copy to clipboard.');
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!bootstrapping && !bootstrapError && preselectedRequestId) {
      setActiveSection('receive');
      setReceiveTab('requests');
    }
  }, [bootstrapping, bootstrapError, preselectedRequestId]);

  useEffect(() => {
    let active = true;
    setBootstrapping(true);
    setWithdrawalBlockedOpen(false);
    setBootstrapError(null);

    Promise.all([bootstrapUserWorkspace(user), checkIsAdmin(user)])
      .then(async ([, adminFlag]) => {
        if (adminFlag) {
          await ensureSeededMembers().catch(() => {});
        }
        if (active) {
          try {
            const rawCreds = sessionStorage.getItem(NEW_CREDENTIALS_STORAGE_KEY);
            if (rawCreds) {
              setNewCredentials(JSON.parse(rawCreds) as GeneratedMemberCredentials);
              sessionStorage.removeItem(NEW_CREDENTIALS_STORAGE_KEY);
            }
          } catch {
            // Ignore storage access errors
          }
          setIsAdmin(adminFlag);
          setBootstrapping(false);
        }
      })
      .catch((err) => {
        if (active) {
          setBootstrapError(err instanceof Error ? err.message : 'Unable to initialize workspace.');
          setBootstrapping(false);
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (bootstrapping || bootstrapError) return;

    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        } else {
          setProfile(null);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      }
    );

    const unsubAdminRole = onSnapshot(
      doc(db, 'admins', user.uid),
      (snap) => {
        const primary = Boolean(
          user.emailVerified && user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()
        );
        setIsAdmin(primary || (Boolean(user.emailVerified) && snap.exists()));
      },
      () => {
        // Non-admins keep primary email check only
      }
    );

    const unsubAccounts = onSnapshot(
      query(collection(db, 'accounts'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as BankAccount)
          .sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt));
        setAccounts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'accounts')
    );

    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as LedgerTransaction)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setTransactions(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );

    const unsubRequests = onSnapshot(
      query(collection(db, 'paymentRequests'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as PaymentRequest)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setPaymentRequests(list);
        setRequestsLoaded(true);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'paymentRequests')
    );

    const unsubBeneficiaries = onSnapshot(
      query(collection(db, 'beneficiaries'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Beneficiary)
          .sort((a, b) => a.name.localeCompare(b.name));
        setBeneficiaries(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'beneficiaries')
    );

    const unsubCards = onSnapshot(
      query(collection(db, 'cards'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as VirtualCard)
          .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
        setCards(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'cards')
    );

    const unsubScheduled = onSnapshot(
      query(collection(db, 'scheduledPayments'), where('userId', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as ScheduledPayment)
          .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
        setScheduledPayments(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'scheduledPayments')
    );

    return () => {
      unsubProfile();
      unsubAdminRole();
      unsubAccounts();
      unsubTransactions();
      unsubRequests();
      unsubBeneficiaries();
      unsubCards();
      unsubScheduled();
    };
  }, [user.uid, user.email, user.emailVerified, bootstrapping, bootstrapError]);

  useEffect(() => {
    if (!isAdmin && activeSection === 'admin') {
      setActiveSection('overview');
    }
  }, [isAdmin, activeSection]);

  const navItems = useMemo(() => {
    if (!isAdmin) return MEMBER_NAV_ITEMS;
    return [
      ...MEMBER_NAV_ITEMS,
      { id: 'admin' as ActiveNavSection, label: 'Admin Console', icon: ShieldCheck },
    ];
  }, [isAdmin]);

  const currentNavLabel =
    navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';

  const handleNavigate = useCallback(
    (section: ActiveNavSection, options?: { receiveTab?: 'direct' | 'requests' }) => {
      if (section === 'receive' && options?.receiveTab) {
        setReceiveTab(options.receiveTab);
      } else if (section === 'receive') {
        setReceiveTab('direct');
      }
      setActiveSection(section);
      setMobileNavOpen(false);
    },
    []
  );

  const handleOpenAccountLedger = useCallback((accountId: string) => {
    setPreselectedLedgerAccountId(accountId);
    setPreselectedLedgerTxId(null);
    setActiveSection('ledger');
    setMobileNavOpen(false);
  }, []);

  const handleInspectTransaction = useCallback((txId: string) => {
    setPreselectedLedgerAccountId('all');
    setPreselectedLedgerTxId(txId);
    setActiveSection('ledger');
    setMobileNavOpen(false);
  }, []);

  const handleClearPreselectedRequest = useCallback(() => {
    setPreselectedRequestId(null);
    if (window.location.search.includes('payRequest')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      notify('error', 'Unable to sign out cleanly. Try refreshing.');
    }
  };

  const renderSidebar = (idPrefix: string) => (
    <div className="h-full flex flex-col justify-between bg-[#0B162C] text-slate-200 border-r border-slate-800/80">
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="h-16 px-6 flex items-center justify-between border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate('overview')}
            className="text-lg font-bold tracking-tight text-white font-[var(--font-display)] whitespace-nowrap shrink-0 cursor-pointer hover:text-sky-300 transition-colors"
          >
            Kestrel Bank
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <nav aria-label="Primary banking navigation" className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`relative w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'text-white'
                      : 'text-slate-300/80 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`sidebarActive-${idPrefix}`}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-white/12 border border-white/15"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative z-10 w-4 h-4 shrink-0" />
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 bg-[#071022]/70 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {profile?.displayName ?? user.displayName ?? 'Member'}
            </p>
            <p className="text-xs text-slate-400 font-mono truncate">
              {profile?.handle ?? user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#EEF2F7] flex">
      {/* Desktop Deep Navy Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {renderSidebar('desktop')}
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 lg:hidden flex"
          >
            <div
              className="fixed inset-0 bg-[#071022]/60 backdrop-blur-[2px]"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-72 max-w-[85vw] h-full"
            >
              {renderSidebar('mobile')}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <button
                type="button"
                onClick={() => handleNavigate('overview')}
                className="text-slate-500 hover:text-slate-900 hidden sm:inline whitespace-nowrap cursor-pointer transition-colors"
              >
                Kestrel Bank
              </button>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate whitespace-nowrap">
                {currentNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleNavigate('admin')}
                className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeSection === 'admin'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleNavigate('transfers')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300/80 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Send Money</span>
            </button>
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => handleNavigate('receive')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Receive Funds</span>
            </motion.button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-[1320px] w-full mx-auto">
          {bootstrapError && (
            <div
              role="alert"
              className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800"
            >
              {bootstrapError}
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeSection === 'overview' && (
                <OverviewView
                  userId={user.uid}
                  accounts={accounts}
                  transactions={transactions}
                  loading={bootstrapping}
                  onNavigate={handleNavigate}
                  onOpenAccountLedger={handleOpenAccountLedger}
                  onInspectTransaction={handleInspectTransaction}
                  onNotify={notify}
                />
              )}

              {activeSection === 'receive' && (
                <ReceiveFundsView
                  userId={user.uid}
                  profile={profile}
                  accounts={accounts}
                  paymentRequests={paymentRequests}
                  activeTab={receiveTab}
                  onTabChange={setReceiveTab}
                  preselectedRequestId={preselectedRequestId}
                  requestsLoaded={requestsLoaded}
                  onClearPreselectedRequest={handleClearPreselectedRequest}
                  onNotify={notify}
                />
              )}

              {activeSection === 'transfers' && (
                <TransferFunds
                  userId={user.uid}
                  profile={profile}
                  accounts={accounts}
                  beneficiaries={beneficiaries}
                  scheduledPayments={scheduledPayments}
                  preselectedBeneficiaryId={preselectedBeneficiaryId}
                  onClearPreselectedBeneficiary={() => setPreselectedBeneficiaryId(null)}
                  onWithdrawalBlocked={handleWithdrawalBlocked}
                  onNotify={notify}
                />
              )}

              {activeSection === 'ledger' && (
                <LedgerView
                  userId={user.uid}
                  profile={profile}
                  accounts={accounts}
                  transactions={transactions}
                  preselectedAccountId={preselectedLedgerAccountId}
                  preselectedTxId={preselectedLedgerTxId}
                  onClearPreselection={() => {
                    setPreselectedLedgerAccountId(null);
                    setPreselectedLedgerTxId(null);
                  }}
                  onWithdrawalBlocked={handleWithdrawalBlocked}
                  onNotify={notify}
                />
              )}

              {activeSection === 'cards' && (
                <CardsView
                  userId={user.uid}
                  profile={profile}
                  accounts={accounts}
                  cards={cards}
                  onWithdrawalBlocked={handleWithdrawalBlocked}
                  onNotify={notify}
                />
              )}

              {activeSection === 'beneficiaries' && (
                <BeneficiariesView
                  userId={user.uid}
                  beneficiaries={beneficiaries}
                  onSendToBeneficiary={(benId) => {
                    setPreselectedBeneficiaryId(benId);
                    setActiveSection('transfers');
                  }}
                  onNotify={notify}
                />
              )}

              {activeSection === 'admin' && isAdmin && (
                <AdminConsoleView
                  adminUid={user.uid}
                  adminName={profile?.displayName ?? user.displayName ?? user.email ?? 'Admin'}
                  adminAccounts={accounts}
                  onNotify={notify}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Blocking Modal on Withdrawal Attempt */}
      <Modal
        open={withdrawalBlockedOpen}
        onClose={() => setWithdrawalBlockedOpen(false)}
        title="Withdrawal Access Frozen"
        subtitle="Outgoing transactions are currently restricted"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-amber-950">
              {WITHDRAWAL_FROZEN_MESSAGE}
            </p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Receiving deposits, viewing balances, and internal sweeps between your own active accounts remain available.
          </p>
          <div className="pt-1 flex justify-end">
            <button
              type="button"
              onClick={() => setWithdrawalBlockedOpen(false)}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Newly Generated Credentials Modal */}
      <Modal
        open={!!newCredentials}
        onClose={() => setNewCredentials(null)}
        title="Your Banking Credentials"
        subtitle={newCredentials ? `Account issued for ${newCredentials.fullName}` : undefined}
        maxWidthClass="max-w-md"
      >
        {newCredentials && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Save your generated Account Number and Routine Number. You will use both numbers to sign in to your Kestrel Bank account on future visits.
            </p>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/60">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500">Account Number</p>
                  <p className="text-base font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                    {newCredentials.accountNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyCredentialValue('acct', newCredentials.accountNumber, 'account number')
                  }
                  className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md cursor-pointer"
                  aria-label="Copy generated account number"
                >
                  {credCopied === 'acct' ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500">Routine Number</p>
                  <p className="text-base font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                    {newCredentials.routineNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyCredentialValue('routine', newCredentials.routineNumber, 'routine number')
                  }
                  className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md cursor-pointer"
                  aria-label="Copy generated routine number"
                >
                  {credCopied === 'routine' ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  copyCredentialValue(
                    'both',
                    `Account Number: ${newCredentials.accountNumber}\nRoutine Number: ${newCredentials.routineNumber}`,
                    'credentials'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{credCopied === 'both' ? 'Copied' : 'Copy Both'}</span>
              </button>
              <button
                type="button"
                onClick={() => setNewCredentials(null)}
                className="px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                Done, Continue
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Live Toast Feedback */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`fixed bottom-5 right-5 z-50 max-w-sm flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-xs font-medium ${
              toast.type === 'success'
                ? 'bg-white border-emerald-200 text-slate-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-700 ml-2 shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
