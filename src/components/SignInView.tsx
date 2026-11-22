import React, { useRef, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Building2, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  loginWithAccountAndRoutine,
  registerMemberWithCredentials,
} from '../services/bankingService';
import type { GenderOption } from '../types/banking';
import { SegmentedTabs } from './ui/SegmentedTabs';

type AuthTab = 'login' | 'signup';

function formatDobInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const SignInView: React.FC = () => {
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const authPortalRef = useRef<HTMLElement | null>(null);
  const loginAccountInputRef = useRef<HTMLInputElement | null>(null);
  const signupNameInputRef = useRef<HTMLInputElement | null>(null);

  // Member Sign-In Fields
  const [accountNumber, setAccountNumber] = useState('');
  const [routineNumber, setRoutineNumber] = useState('');

  // Member Sign-Up Fields
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<GenderOption>('Male');
  const [email, setEmail] = useState('');

  const jumpToAuthPortal = (targetTab: AuthTab) => {
    setAuthTab(targetTab);
    setError(null);
    authPortalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      if (targetTab === 'login') {
        loginAccountInputRef.current?.focus({ preventScroll: true });
      } else {
        signupNameInputRef.current?.focus({ preventScroll: true });
      }
    }, 260);
  };

  const handleMemberSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      await loginWithAccountAndRoutine({
        accountNumber,
        routineNumber,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleMemberSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      await registerMemberWithCredentials({
        fullName,
        dateOfBirth,
        gender,
        email,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create member account.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      let message =
        'Unable to complete Google sign-in. Please verify popup permissions and try again.';
      if (code === 'auth/popup-closed-by-user') {
        message = 'Google sign-in window was closed before completing authentication.';
      } else if (code === 'auth/popup-blocked') {
        message = 'Sign-in popup was blocked by your browser. Please allow popups for this site.';
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#EEF2F7] text-slate-900">
      {/* Top Navigation Bar (3-zone contract) */}
      <header className="sticky top-0 z-30 bg-[#0B162C]/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto h-16 px-6 sm:px-10 flex items-center justify-between gap-8">
          <a
            href="#hero"
            className="text-lg font-bold tracking-tight text-white font-[var(--font-display)] whitespace-nowrap shrink-0"
          >
            Kestrel Bank
          </a>

          <nav
            aria-label="Home navigation"
            className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-300"
          >
            <a
              href="#hero"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#auth-portal"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Member Access
            </a>
            <a
              href="#capabilities"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#security"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Custody
            </a>
          </nav>

          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => jumpToAuthPortal('login')}
            className="px-4 py-2 text-xs font-semibold text-[#0B162C] bg-white hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Member Sign In
          </motion.button>
        </div>
      </header>

      {/* Full-Width Top Architectural Hero Banner */}
      <section
        id="hero"
        aria-label="Kestrel Bank architectural hero"
        className="relative overflow-hidden bg-[#0B162C] border-b border-slate-800/80"
      >
        <div className="absolute inset-0 pointer-events-none">
          {!imgFailed ? (
            <motion.img
              initial={{ scale: 1.04, opacity: 0.85 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              src="/src/assets/images/kestrel_atrium_architecture_1795218363378.jpg"
              alt="Kestrel Bank travertine and glass architectural atrium"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#071022] via-[#0B162C] to-[#132952] flex items-center justify-end p-12 opacity-60">
              <Building2 className="w-32 h-32 text-slate-500/40" />
            </div>
          )}
          {/* Measured navy contrast scrim across the image */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#071022]/94 via-[#0B162C]/82 to-[#0B162C]/50" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071022]/85 via-transparent to-[#071022]/35" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 py-14 sm:py-20 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <p className="text-xs font-medium text-sky-300 tracking-wide mb-3">
              Commercial &amp; Personal Treasury Infrastructure
            </p>
            <h1 className="text-[clamp(2rem,4vw,3.35rem)] font-semibold tracking-tight text-white leading-[1.08]">
              Receive funds, settle invoices, and govern every transaction in one ledger.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-200/90 leading-relaxed max-w-xl">
              Sign in with your Account Number and Routine Number, or open a new member account to receive generated banking credentials immediately.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => jumpToAuthPortal('login')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#0B162C] bg-white hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                <span>Access Member Portal</span>
                <ArrowRight className="w-4 h-4" />
              </motion.button>
              <button
                type="button"
                onClick={() => jumpToAuthPortal('signup')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-200 hover:text-white underline decoration-white/35 underline-offset-4 hover:decoration-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Open New Account</span>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Main Cool-Slate Layered Workspace Below Hero */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 py-10 sm:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Member Authentication & Onboarding Card */}
            <motion.section
              id="auth-portal"
              ref={authPortalRef}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              aria-label="Member Sign In and Account Opening"
              className="lg:col-span-7 bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden scroll-mt-24"
            >
              <div className="px-6 sm:px-8 py-5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Member Treasury Portal
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Authenticate with issued banking numbers or open a new deposit account
                  </p>
                </div>

                <SegmentedTabs
                  layoutId="homeAuthTab"
                  value={authTab}
                  onChange={(next) => {
                    setAuthTab(next);
                    setError(null);
                  }}
                  options={[
                    {
                      id: 'login',
                      label: 'Member Sign In',
                      icon: <KeyRound className="w-3.5 h-3.5" />,
                    },
                    {
                      id: 'signup',
                      label: 'Open Account',
                      icon: <UserPlus className="w-3.5 h-3.5" />,
                    },
                  ]}
                />
              </div>

              <div className="p-6 sm:p-8">
                {error && (
                  <div
                    role="alert"
                    className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed"
                  >
                    {error}
                  </div>
                )}

                <AnimatePresence mode="wait">
                  {authTab === 'login' ? (
                    <motion.form
                      key="login-form"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      onSubmit={handleMemberSignIn}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="login-acct-num"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Account Number
                          </label>
                          <input
                            ref={loginAccountInputRef}
                            id="login-acct-num"
                            type="text"
                            inputMode="numeric"
                            autoComplete="username"
                            required
                            maxLength={12}
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                            placeholder="10-digit account number"
                            className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="login-routine-num"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Routine Number
                          </label>
                          <input
                            id="login-routine-num"
                            type="text"
                            inputMode="numeric"
                            autoComplete="current-password"
                            required
                            maxLength={11}
                            value={routineNumber}
                            onChange={(e) => setRoutineNumber(e.target.value.replace(/\D/g, ''))}
                            placeholder="9–11 digit routine number"
                            className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          />
                        </div>
                      </div>

                      <motion.button
                        type="submit"
                        disabled={signingIn}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0B162C] hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                      >
                        <span>{signingIn ? 'Verifying Credentials...' : 'Sign In to Account'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.button>
                    </motion.form>
                  ) : (
                    <motion.form
                      key="signup-form"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      onSubmit={handleMemberSignUp}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="signup-fullname"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Full Name
                          </label>
                          <input
                            ref={signupNameInputRef}
                            id="signup-fullname"
                            type="text"
                            required
                            minLength={2}
                            maxLength={80}
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="e.g. Jordan Ellis"
                            className="w-full px-3.5 py-2 text-sm bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="signup-email"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Email Address
                          </label>
                          <input
                            id="signup-email"
                            type="email"
                            required
                            maxLength={120}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full px-3.5 py-2 text-sm bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="signup-dob"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Date of Birth (DD/MM/YYYY)
                          </label>
                          <input
                            id="signup-dob"
                            type="text"
                            inputMode="numeric"
                            required
                            maxLength={10}
                            value={dateOfBirth}
                            onChange={(e) => setDateOfBirth(formatDobInput(e.target.value))}
                            placeholder="DD/MM/YYYY"
                            className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="signup-gender"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Gender
                          </label>
                          <select
                            id="signup-gender"
                            value={gender}
                            onChange={(e) => setGender(e.target.value as GenderOption)}
                            className="w-full px-3.5 py-2 text-sm bg-slate-50/60 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 transition-colors"
                          >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                            <option value="Prefer not to say">Prefer not to say</option>
                          </select>
                        </div>
                      </div>

                      <motion.button
                        type="submit"
                        disabled={signingIn}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0B162C] hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                      >
                        <span>
                          {signingIn
                            ? 'Generating Account & Routine Numbers...'
                            : 'Create Account & Generate Numbers'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.button>
                    </motion.form>
                  )}
                </AnimatePresence>

                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-[11px]">
                    <span className="px-2.5 bg-white text-slate-500">
                      Administrator &amp; Google Sign-In
                    </span>
                  </div>
                </div>

                <motion.button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-300 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>{signingIn ? 'Authenticating...' : 'Continue with Google'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            </motion.section>

            {/* Right Column: Layered Capabilities & Deep Navy Custody Panel */}
            <div className="lg:col-span-5 space-y-6">
              <motion.section
                id="capabilities"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden scroll-mt-24"
              >
                <div className="px-6 py-4 bg-slate-50/90 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Platform Capabilities
                  </h2>
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      01. Instant Banking Credentials
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed mt-1">
                      Dedicated 10-digit account and routine numbers are issued immediately at onboarding for direct login and inbound wires.
                    </p>
                  </div>
                  <div className="px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      02. Transfers, Requests &amp; Cards
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed mt-1">
                      Accept ACH deposits, generate QR payment invoices, sweep balances internally, and enforce virtual debit card limits.
                    </p>
                  </div>
                  <div className="px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      03. Audit-Ready Settlement Ledger
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed mt-1">
                      Cent-accurate transaction records across USD, EUR, and GBP accounts with instant receipt inspection and CSV export.
                    </p>
                  </div>
                </div>
              </motion.section>

              <motion.section
                id="security"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="bg-gradient-to-br from-[#0B162C] via-[#10203F] to-[#132952] text-white border border-slate-800 rounded-xl shadow-xs p-6 scroll-mt-24"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-sky-300 mb-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Institutional Custody &amp; Governance</span>
                </div>
                <p className="text-base font-semibold leading-snug">
                  Designed for clear cash visibility, rapid inbound settlement, and disciplined financial control.
                </p>
                <p className="text-xs text-slate-300 leading-relaxed mt-2.5">
                  Every deposit, invoice settlement, and outgoing disbursement executes atomically with administrator oversight and per-account freeze safeguards.
                </p>
                <div className="mt-5 pt-4 border-t border-white/15 flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
                  <span>Multi-Currency Ledger</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span>Atomic Settlement</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span>Role-Based Governance</span>
                </div>
              </motion.section>
            </div>
          </div>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200/90 bg-[#E4EAF3] py-5 px-6 sm:px-10">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <span className="font-semibold text-slate-900 font-[var(--font-display)]">
            Kestrel Bank
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <span>Account &amp; Routine Credential Auth</span>
            <span aria-hidden="true">·</span>
            <span>USD / EUR / GBP Multi-Account Ledger</span>
            <span aria-hidden="true">·</span>
            <span>Atomic Settlement</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
