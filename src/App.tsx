import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { MotionConfig, motion } from 'motion/react';
import { auth } from './lib/firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInView } from './components/SignInView';
import { DashboardShell } from './components/DashboardShell';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  if (!authReady) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen bg-[#0B162C] flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="text-center space-y-2.5"
          >
            <p className="text-lg font-semibold text-white font-[var(--font-display)] tracking-tight">
              Kestrel Bank
            </p>
            <p className="text-xs text-slate-300">Verifying session...</p>
          </motion.div>
        </div>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        {user ? <DashboardShell user={user} /> : <SignInView />}
      </ErrorBoundary>
    </MotionConfig>
  );
}
