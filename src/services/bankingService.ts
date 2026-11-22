import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  advanceDateString,
  generateAccountNumber,
  generateIban,
  generateReferenceCode,
  generateRoutineNumber,
  generateShortId,
  isValidDDMMYYYY,
  sha256Hex,
} from '../lib/format';
import {
  BLUEPRINT_LIMITS,
  PRIMARY_ADMIN_EMAIL,
  SEEDED_CHRISTOPHER_MASON,
  WITHDRAWAL_FROZEN_MESSAGE,
  type AccountStatus,
  type AccountType,
  type AdminTopUpFundingMode,
  type BankAccount,
  type Beneficiary,
  type BeneficiaryAccountType,
  type CardNetwork,
  type CardStatus,
  type CurrencyCode,
  type GenderOption,
  type LedgerTransaction,
  type MemberCredential,
  type PaymentRequest,
  type RecipientDirectoryEntry,
  type ScheduledCadence,
  type ScheduledPayment,
  type TxType,
  type UserProfile,
  type VirtualCard,
} from '../types/banking';

function sanitizeString(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'permission-denied') return true;
  if (err instanceof Error) {
    return /permission[-_\s]?denied|missing or insufficient permissions/i.test(err.message);
  }
  return false;
}

function buildUserHandle(user: User, suffix = ''): string {
  const rawBase = (user.email?.split('@')[0] || user.displayName || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  const maxBase = suffix ? 28 - suffix.length : 28;
  const trimmed = (rawBase.slice(0, maxBase) || 'member') + suffix;
  return `@${trimmed}`;
}

function normalizeHandleLookupKey(handle: string): string {
  const cleaned = handle.replace(/^@+/, '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return `hdl_${cleaned}`.slice(0, 80);
}

async function upsertDirectoryKey(
  lookupKey: string,
  payload: {
    accountId: string;
    userId: string;
    displayName: string;
    handle: string;
    accountName: string;
    accountLast4: string;
    currency: CurrencyCode;
    status: AccountStatus;
  },
  onlyIfMissingOrOwned = true
): Promise<void> {
  if (!BLUEPRINT_LIMITS.LOOKUP_KEY_REGEX.test(lookupKey) || lookupKey.length < 4 || lookupKey.length > 80) {
    return;
  }
  const ref = doc(db, 'recipientDirectory', lookupKey);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        lookupKey,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }
    const existing = snap.data() as RecipientDirectoryEntry;
    if (onlyIfMissingOrOwned && existing.userId !== payload.userId) {
      return;
    }
    if (existing.accountId !== payload.accountId) {
      return;
    }
    if (
      existing.displayName !== payload.displayName ||
      existing.handle !== payload.handle ||
      existing.accountName !== payload.accountName ||
      existing.status !== payload.status
    ) {
      await updateDoc(ref, {
        displayName: payload.displayName,
        handle: payload.handle,
        accountName: payload.accountName,
        status: payload.status,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, `recipientDirectory/${lookupKey}`);
  }
}

export async function syncAccountDirectoryEntries(params: {
  account: Pick<BankAccount, 'id' | 'userId' | 'name' | 'accountNumber' | 'currency' | 'status'>;
  displayName: string;
  handle: string;
  email?: string;
  includeHandleAndEmail?: boolean;
}): Promise<void> {
  const { account, displayName, handle, email, includeHandleAndEmail } = params;
  const basePayload = {
    accountId: account.id,
    userId: account.userId,
    displayName: sanitizeString(displayName, BLUEPRINT_LIMITS.PARTY_MAX) || 'Account Holder',
    handle: BLUEPRINT_LIMITS.HANDLE_REGEX.test(handle) ? handle : '@member',
    accountName: sanitizeString(account.name, BLUEPRINT_LIMITS.NAME_MAX) || 'Bank Account',
    accountLast4: account.accountNumber.slice(-4),
    currency: account.currency,
    status: account.status,
  };

  await upsertDirectoryKey(`num_${account.accountNumber}`, basePayload);

  if (includeHandleAndEmail) {
    const handleKey = normalizeHandleLookupKey(basePayload.handle);
    await upsertDirectoryKey(handleKey, basePayload);
    if (email && email.trim().length >= 3) {
      const emailHash = await sha256Hex(email);
      await upsertDirectoryKey(`eml_${emailHash}`, basePayload);
    }
  }
}

async function syncDirectoryForAccountId(accountId: string): Promise<void> {
  try {
    const accSnap = await getDoc(doc(db, 'accounts', accountId));
    if (!accSnap.exists()) return;
    const acc = accSnap.data() as BankAccount;
    const userSnap = await getDoc(doc(db, 'users', acc.userId));
    if (!userSnap.exists()) return;
    const profile = userSnap.data() as UserProfile;
    await syncAccountDirectoryEntries({
      account: acc,
      displayName: profile.displayName,
      handle: profile.handle,
      email: profile.email,
      includeHandleAndEmail: true,
    });
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.WRITE, `recipientDirectory/${accountId}`);
    }
  }
}

export const NEW_CREDENTIALS_STORAGE_KEY = 'kestrel_new_credentials';
const SIGNUP_DRAFT_STORAGE_KEY = 'kestrel_signup_draft';

export interface GeneratedMemberCredentials {
  accountNumber: string;
  routineNumber: string;
  fullName: string;
}

interface PendingSignupDraft {
  authEmail: string;
  fullName: string;
  dateOfBirth: string;
  gender: GenderOption;
  contactEmail: string;
  accountNumber: string;
  routineNumber: string;
}

const activeBootstrapPromises = new Map<string, Promise<void>>();
let activeSeedMembersPromise: Promise<void> | null = null;

function deriveMemberAuthEmail(accountNumber: string): string {
  return `acct_${accountNumber.trim()}@members.kestrelbank.com`;
}

async function deriveMemberAuthPassword(accountNumber: string, routineNumber: string): Promise<string> {
  const hash = await sha256Hex(`${accountNumber.trim()}:${routineNumber.trim()}:kestrel-member-v1`);
  return `Kstl#${hash.slice(0, 32)}`;
}

async function computeCredentialHash(accountNumber: string, routineNumber: string): Promise<string> {
  return sha256Hex(`${accountNumber.trim()}:${routineNumber.trim()}`);
}

function buildHandleFromNameOrEmail(nameOrEmail: string, suffix = ''): string {
  const rawBase = nameOrEmail
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  const maxBase = suffix ? 28 - suffix.length : 28;
  const trimmed = (rawBase.slice(0, maxBase) || 'member') + suffix;
  return `@${trimmed}`;
}

function readPendingSignupDraft(authEmail: string | null | undefined): PendingSignupDraft | null {
  if (!authEmail) return null;
  try {
    const raw = sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignupDraft;
    if (parsed.authEmail.toLowerCase() !== authEmail.toLowerCase()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingSignupDraft(): void {
  try {
    sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage restriction
  }
}

function mapCredentialAuthError(err: unknown): Error {
  const code = (err as { code?: string } | null)?.code ?? '';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return new Error(
      'Account/Routine authentication requires Email/Password sign-in to be enabled in the Firebase Console (Authentication → Sign-in method → Email/Password).'
    );
  }
  if (code === 'auth/too-many-requests') {
    return new Error('Too many sign-in attempts. Please wait a moment and try again.');
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password'
  ) {
    return new Error('Invalid account number or routine number. Verify your credentials and try again.');
  }
  if (err instanceof Error) return err;
  return new Error('Authentication failed. Please try again.');
}

export async function registerMemberWithCredentials(params: {
  fullName: string;
  dateOfBirth: string;
  gender: GenderOption;
  email: string;
}): Promise<GeneratedMemberCredentials> {
  const fullName = sanitizeString(params.fullName, BLUEPRINT_LIMITS.PARTY_MAX);
  const dateOfBirth = params.dateOfBirth.trim();
  const contactEmail = sanitizeString(params.email, BLUEPRINT_LIMITS.EMAIL_MAX).toLowerCase();

  if (fullName.length < 2) {
    throw new Error('Enter your full name (at least 2 characters).');
  }
  if (!BLUEPRINT_LIMITS.DOB_REGEX.test(dateOfBirth) || !isValidDDMMYYYY(dateOfBirth)) {
    throw new Error('Enter a valid date of birth in DD/MM/YYYY format.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    throw new Error('Enter a valid email address.');
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let accountNumber = generateAccountNumber();
    if (accountNumber === SEEDED_CHRISTOPHER_MASON.accountNumber) {
      accountNumber = generateAccountNumber();
    }
    const routineNumber = generateRoutineNumber();
    const authEmail = deriveMemberAuthEmail(accountNumber);
    const authPassword = await deriveMemberAuthPassword(accountNumber, routineNumber);

    const draft: PendingSignupDraft = {
      authEmail,
      fullName,
      dateOfBirth,
      gender: params.gender,
      contactEmail,
      accountNumber,
      routineNumber,
    };

    try {
      sessionStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      sessionStorage.setItem(
        NEW_CREDENTIALS_STORAGE_KEY,
        JSON.stringify({ accountNumber, routineNumber, fullName } satisfies GeneratedMemberCredentials)
      );
    } catch {
      // Continue even if sessionStorage is unavailable
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
      await bootstrapUserWorkspace(cred.user);
      return { accountNumber, routineNumber, fullName };
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string } | null)?.code;
      clearPendingSignupDraft();
      try {
        sessionStorage.removeItem(NEW_CREDENTIALS_STORAGE_KEY);
      } catch {
        // Ignore
      }
      if (code === 'auth/email-already-in-use') {
        continue;
      }
      throw mapCredentialAuthError(err);
    }
  }

  throw mapCredentialAuthError(lastErr);
}

export async function loginWithAccountAndRoutine(params: {
  accountNumber: string;
  routineNumber: string;
}): Promise<void> {
  const cleanAccount = params.accountNumber.replace(/\D/g, '');
  const cleanRoutine = params.routineNumber.replace(/\D/g, '');

  if (
    !BLUEPRINT_LIMITS.ACCOUNT_NUMBER_REGEX.test(cleanAccount) ||
    !BLUEPRINT_LIMITS.BANK_ROUTING_REGEX.test(cleanRoutine)
  ) {
    throw new Error('Enter a valid account number (10–12 digits) and routine number (9–11 digits).');
  }

  const authEmail = deriveMemberAuthEmail(cleanAccount);
  const authPassword = await deriveMemberAuthPassword(cleanAccount, cleanRoutine);

  try {
    await signInWithEmailAndPassword(auth, authEmail, authPassword);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const isSeededChristopher =
      cleanAccount === SEEDED_CHRISTOPHER_MASON.accountNumber &&
      cleanRoutine === SEEDED_CHRISTOPHER_MASON.routingNumber;

    if (
      isSeededChristopher &&
      (code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password')
    ) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        await updateProfile(cred.user, {
          displayName: SEEDED_CHRISTOPHER_MASON.displayName,
        }).catch(() => {});
        return;
      } catch (createErr) {
        const createCode = (createErr as { code?: string } | null)?.code;
        if (createCode === 'auth/email-already-in-use') {
          throw new Error('Invalid account number or routine number.');
        }
        throw mapCredentialAuthError(createErr);
      }
    }

    throw mapCredentialAuthError(err);
  }
}

export async function ensureSeededMembers(): Promise<void> {
  if (activeSeedMembersPromise) {
    return activeSeedMembersPromise;
  }

  const run = async () => {
    const credRef = doc(db, 'memberCredentials', SEEDED_CHRISTOPHER_MASON.accountNumber);
    try {
      const credSnap = await getDoc(credRef);
      if (credSnap.exists()) {
        return;
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) return;
      handleFirestoreError(err, OperationType.GET, `memberCredentials/${SEEDED_CHRISTOPHER_MASON.accountNumber}`);
    }

    const routingHash = await computeCredentialHash(
      SEEDED_CHRISTOPHER_MASON.accountNumber,
      SEEDED_CHRISTOPHER_MASON.routingNumber
    );

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', SEEDED_CHRISTOPHER_MASON.seededUserId), {
        uid: SEEDED_CHRISTOPHER_MASON.seededUserId,
        displayName: SEEDED_CHRISTOPHER_MASON.displayName,
        email: SEEDED_CHRISTOPHER_MASON.email,
        handle: SEEDED_CHRISTOPHER_MASON.handle,
        dateOfBirth: SEEDED_CHRISTOPHER_MASON.dateOfBirth,
        gender: SEEDED_CHRISTOPHER_MASON.gender,
        primaryAccountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        primaryRoutingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
        withdrawalFrozen: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'accounts', SEEDED_CHRISTOPHER_MASON.seededAccountId), {
        id: SEEDED_CHRISTOPHER_MASON.seededAccountId,
        userId: SEEDED_CHRISTOPHER_MASON.seededUserId,
        name: 'Primary Checking',
        accountType: 'checking',
        currency: 'USD',
        accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        routingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
        iban: generateIban(
          SEEDED_CHRISTOPHER_MASON.accountNumber,
          SEEDED_CHRISTOPHER_MASON.routingNumber
        ),
        balanceCents: 0,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(credRef, {
        accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        routingHash,
        claimProof: '',
        userId: SEEDED_CHRISTOPHER_MASON.seededUserId,
        claimedUid: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (err) {
      if (!isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.WRITE, 'users/member_0036028172');
      }
      return;
    }

    await syncAccountDirectoryEntries({
      account: {
        id: SEEDED_CHRISTOPHER_MASON.seededAccountId,
        userId: SEEDED_CHRISTOPHER_MASON.seededUserId,
        name: 'Primary Checking',
        accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        currency: 'USD',
        status: 'active',
      },
      displayName: SEEDED_CHRISTOPHER_MASON.displayName,
      handle: SEEDED_CHRISTOPHER_MASON.handle,
      email: SEEDED_CHRISTOPHER_MASON.email,
      includeHandleAndEmail: true,
    });
  };

  activeSeedMembersPromise = run().finally(() => {
    activeSeedMembersPromise = null;
  });
  return activeSeedMembersPromise;
}

async function claimOrSeedChristopherMason(user: User): Promise<void> {
  const credRef = doc(db, 'memberCredentials', SEEDED_CHRISTOPHER_MASON.accountNumber);
  const routingHash = await computeCredentialHash(
    SEEDED_CHRISTOPHER_MASON.accountNumber,
    SEEDED_CHRISTOPHER_MASON.routingNumber
  );

  let credSnap;
  try {
    credSnap = await getDoc(credRef);
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, `memberCredentials/${SEEDED_CHRISTOPHER_MASON.accountNumber}`);
    }
    credSnap = null;
  }

  if (credSnap && credSnap.exists()) {
    const cred = credSnap.data() as MemberCredential;
    if (cred.claimedUid === '') {
      await updateDoc(credRef, {
        claimedUid: user.uid,
        userId: user.uid,
        claimProof: routingHash,
        updatedAt: serverTimestamp(),
      });
    } else if (cred.claimedUid !== user.uid) {
      throw new Error('This member account has already been claimed.');
    }

    const seededUserRef = doc(db, 'users', SEEDED_CHRISTOPHER_MASON.seededUserId);
    const liveUserRef = doc(db, 'users', user.uid);
    const seededAccRef = doc(db, 'accounts', SEEDED_CHRISTOPHER_MASON.seededAccountId);

    const [seededUserSnap, liveUserSnap, seededAccSnap] = await Promise.all([
      getDoc(seededUserRef).catch(() => null),
      getDoc(liveUserRef),
      getDoc(seededAccRef).catch(() => null),
    ]);

    const seededUser =
      seededUserSnap && seededUserSnap.exists() ? (seededUserSnap.data() as UserProfile) : null;

    if (!liveUserSnap.exists()) {
      await setDoc(liveUserRef, {
        uid: user.uid,
        displayName: seededUser?.displayName ?? SEEDED_CHRISTOPHER_MASON.displayName,
        email: seededUser?.email ?? SEEDED_CHRISTOPHER_MASON.email,
        handle: seededUser?.handle ?? SEEDED_CHRISTOPHER_MASON.handle,
        dateOfBirth: seededUser?.dateOfBirth ?? SEEDED_CHRISTOPHER_MASON.dateOfBirth,
        gender: seededUser?.gender ?? SEEDED_CHRISTOPHER_MASON.gender,
        primaryAccountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        primaryRoutingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
        withdrawalFrozen: seededUser?.withdrawalFrozen ?? true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    let accData: BankAccount | null = null;
    if (seededAccSnap && seededAccSnap.exists()) {
      accData = seededAccSnap.data() as BankAccount;
      if (accData.userId === SEEDED_CHRISTOPHER_MASON.seededUserId) {
        await updateDoc(seededAccRef, {
          userId: user.uid,
          updatedAt: serverTimestamp(),
        });
        accData = { ...accData, userId: user.uid };
      }
    } else {
      accData = {
        id: SEEDED_CHRISTOPHER_MASON.seededAccountId,
        userId: user.uid,
        name: 'Primary Checking',
        accountType: 'checking',
        currency: 'USD',
        accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
        routingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
        iban: generateIban(
          SEEDED_CHRISTOPHER_MASON.accountNumber,
          SEEDED_CHRISTOPHER_MASON.routingNumber
        ),
        balanceCents: 0,
        status: 'active',
        createdAt: null,
        updatedAt: null,
      };
      await setDoc(seededAccRef, {
        id: accData.id,
        userId: accData.userId,
        name: accData.name,
        accountType: accData.accountType,
        currency: accData.currency,
        accountNumber: accData.accountNumber,
        routingNumber: accData.routingNumber,
        iban: accData.iban,
        balanceCents: accData.balanceCents,
        status: accData.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const emailHash = await sha256Hex(seededUser?.email ?? SEEDED_CHRISTOPHER_MASON.email);
    const dirKeys = [
      `num_${SEEDED_CHRISTOPHER_MASON.accountNumber}`,
      normalizeHandleLookupKey(seededUser?.handle ?? SEEDED_CHRISTOPHER_MASON.handle),
      `eml_${emailHash}`,
    ];
    for (const key of dirKeys) {
      const dirRef = doc(db, 'recipientDirectory', key);
      const dirSnap = await getDoc(dirRef).catch(() => null);
      if (dirSnap && dirSnap.exists()) {
        const entry = dirSnap.data() as RecipientDirectoryEntry;
        if (entry.userId === SEEDED_CHRISTOPHER_MASON.seededUserId) {
          await updateDoc(dirRef, {
            userId: user.uid,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    await syncAccountDirectoryEntries({
      account: accData,
      displayName: seededUser?.displayName ?? SEEDED_CHRISTOPHER_MASON.displayName,
      handle: seededUser?.handle ?? SEEDED_CHRISTOPHER_MASON.handle,
      email: seededUser?.email ?? SEEDED_CHRISTOPHER_MASON.email,
      includeHandleAndEmail: true,
    });

    if (seededUserSnap && seededUserSnap.exists()) {
      await deleteDoc(seededUserRef).catch(() => {});
    }
    return;
  }

  // Fallback when Christopher Mason logs in before an admin has visited the console
  const liveUserRef = doc(db, 'users', user.uid);
  const seededAccRef = doc(db, 'accounts', SEEDED_CHRISTOPHER_MASON.seededAccountId);
  const [liveUserSnap, seededAccSnap] = await Promise.all([
    getDoc(liveUserRef),
    getDoc(seededAccRef).catch(() => null),
  ]);

  const batch = writeBatch(db);
  if (!liveUserSnap.exists()) {
    batch.set(liveUserRef, {
      uid: user.uid,
      displayName: SEEDED_CHRISTOPHER_MASON.displayName,
      email: SEEDED_CHRISTOPHER_MASON.email,
      handle: SEEDED_CHRISTOPHER_MASON.handle,
      dateOfBirth: SEEDED_CHRISTOPHER_MASON.dateOfBirth,
      gender: SEEDED_CHRISTOPHER_MASON.gender,
      primaryAccountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
      primaryRoutingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
      withdrawalFrozen: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  if (!seededAccSnap || !seededAccSnap.exists()) {
    batch.set(seededAccRef, {
      id: SEEDED_CHRISTOPHER_MASON.seededAccountId,
      userId: user.uid,
      name: 'Primary Checking',
      accountType: 'checking',
      currency: 'USD',
      accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
      routingNumber: SEEDED_CHRISTOPHER_MASON.routingNumber,
      iban: generateIban(
        SEEDED_CHRISTOPHER_MASON.accountNumber,
        SEEDED_CHRISTOPHER_MASON.routingNumber
      ),
      balanceCents: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  batch.set(credRef, {
    accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
    routingHash,
    claimProof: '',
    userId: user.uid,
    claimedUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  await syncAccountDirectoryEntries({
    account: {
      id: SEEDED_CHRISTOPHER_MASON.seededAccountId,
      userId: user.uid,
      name: 'Primary Checking',
      accountNumber: SEEDED_CHRISTOPHER_MASON.accountNumber,
      currency: 'USD',
      status: 'active',
    },
    displayName: SEEDED_CHRISTOPHER_MASON.displayName,
    handle: SEEDED_CHRISTOPHER_MASON.handle,
    email: SEEDED_CHRISTOPHER_MASON.email,
    includeHandleAndEmail: true,
  });
}

async function bootstrapPendingMemberFromDraft(user: User, draft: PendingSignupDraft): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  const existingUserSnap = await getDoc(userRef);

  let handle = buildHandleFromNameOrEmail(draft.fullName);
  try {
    const candidateKey = normalizeHandleLookupKey(handle);
    const handleSnap = await getDoc(doc(db, 'recipientDirectory', candidateKey));
    if (handleSnap.exists() && (handleSnap.data() as RecipientDirectoryEntry).userId !== user.uid) {
      handle = buildHandleFromNameOrEmail(draft.fullName, `_${user.uid.slice(0, 4).toLowerCase()}`);
    }
  } catch {
    // Keep generated handle
  }

  const accId = generateShortId('acc');
  const routingHash = await computeCredentialHash(draft.accountNumber, draft.routineNumber);

  const batch = writeBatch(db);
  if (!existingUserSnap.exists()) {
    batch.set(userRef, {
      uid: user.uid,
      displayName: draft.fullName,
      email: draft.contactEmail,
      handle,
      dateOfBirth: draft.dateOfBirth,
      gender: draft.gender,
      primaryAccountNumber: draft.accountNumber,
      primaryRoutingNumber: draft.routineNumber,
      withdrawalFrozen: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'accounts', accId), {
    id: accId,
    userId: user.uid,
    name: 'Primary Checking',
    accountType: 'checking',
    currency: 'USD',
    accountNumber: draft.accountNumber,
    routingNumber: draft.routineNumber,
    iban: generateIban(draft.accountNumber, draft.routineNumber),
    balanceCents: 0,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'memberCredentials', draft.accountNumber), {
    accountNumber: draft.accountNumber,
    routingHash,
    claimProof: '',
    userId: user.uid,
    claimedUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  clearPendingSignupDraft();

  await syncAccountDirectoryEntries({
    account: {
      id: accId,
      userId: user.uid,
      name: 'Primary Checking',
      accountNumber: draft.accountNumber,
      currency: 'USD',
      status: 'active',
    },
    displayName: draft.fullName,
    handle,
    email: draft.contactEmail,
    includeHandleAndEmail: true,
  });
}

export async function bootstrapUserWorkspace(user: User): Promise<void> {
  const existingPromise = activeBootstrapPromises.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const runPromise = runBootstrapUserWorkspace(user).finally(() => {
    activeBootstrapPromises.delete(user.uid);
  });
  activeBootstrapPromises.set(user.uid, runPromise);
  return runPromise;
}

async function runBootstrapUserWorkspace(user: User): Promise<void> {
  if (
    user.email?.toLowerCase() ===
    deriveMemberAuthEmail(SEEDED_CHRISTOPHER_MASON.accountNumber).toLowerCase()
  ) {
    await claimOrSeedChristopherMason(user);
    return;
  }

  const draft = readPendingSignupDraft(user.email);

  const userRef = doc(db, 'users', user.uid);
  let userExists = false;
  let existingProfile: UserProfile | null = null;
  let existingAccounts: BankAccount[] = [];

  try {
    const userSnap = await getDoc(userRef);
    userExists = userSnap.exists();
    if (userExists) {
      existingProfile = userSnap.data() as UserProfile;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
  }

  try {
    const accountsSnap = await getDocs(
      query(collection(db, 'accounts'), where('userId', '==', user.uid))
    );
    existingAccounts = accountsSnap.docs.map((d) => d.data() as BankAccount);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'accounts');
  }

  const hasAccounts = existingAccounts.length > 0;

  if (draft && !hasAccounts) {
    await bootstrapPendingMemberFromDraft(user, draft);
    return;
  }

  const rawDisplayName = sanitizeString(user.displayName || 'Account Holder', BLUEPRINT_LIMITS.PARTY_MAX);
  const displayName = existingProfile?.displayName ?? (rawDisplayName.length >= 2 ? rawDisplayName : 'Account Holder');
  const email = existingProfile?.email ?? sanitizeString(user.email || 'member@kestrelbank.com', BLUEPRINT_LIMITS.EMAIL_MAX);

  let handle = existingProfile?.handle ?? buildUserHandle(user);
  if (!existingProfile) {
    try {
      const candidateKey = normalizeHandleLookupKey(handle);
      const handleSnap = await getDoc(doc(db, 'recipientDirectory', candidateKey));
      if (handleSnap.exists() && (handleSnap.data() as RecipientDirectoryEntry).userId !== user.uid) {
        handle = buildUserHandle(user, `_${user.uid.slice(0, 4).toLowerCase()}`);
      }
    } catch {
      // Fallback to default handle if lookup fails
    }
  }

  if (userExists && hasAccounts) {
    // Ensure returning accounts also have recipient directory lookup entries populated
    const primaryAcc = existingAccounts.find((a) => a.accountType === 'checking') ?? existingAccounts[0];
    for (const acc of existingAccounts) {
      await syncAccountDirectoryEntries({
        account: acc,
        displayName,
        handle,
        email,
        includeHandleAndEmail: acc.id === primaryAcc.id,
      });
    }
    return;
  }

  const checkingId = generateShortId('acc');
  const treasuryId = generateShortId('acc');
  const checkingNumber = generateAccountNumber();
  const treasuryNumber = generateAccountNumber();
  const checkingRouting = generateRoutineNumber();
  const treasuryRouting = generateRoutineNumber();

  // Batch 1: Create user profile and base bank accounts first so ownsAccount() rules succeed in Batch 2
  try {
    const batch1 = writeBatch(db);
    if (!userExists) {
      batch1.set(userRef, {
        uid: user.uid,
        displayName,
        email,
        handle,
        primaryAccountNumber: checkingNumber,
        primaryRoutingNumber: checkingRouting,
        withdrawalFrozen: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (!hasAccounts) {
      batch1.set(doc(db, 'accounts', checkingId), {
        id: checkingId,
        userId: user.uid,
        name: 'Operating Checking',
        accountType: 'checking',
        currency: 'USD',
        accountNumber: checkingNumber,
        routingNumber: checkingRouting,
        iban: generateIban(checkingNumber, checkingRouting),
        balanceCents: 1485000,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch1.set(doc(db, 'accounts', treasuryId), {
        id: treasuryId,
        userId: user.uid,
        name: 'Treasury Reserve',
        accountType: 'treasury',
        currency: 'USD',
        accountNumber: treasuryNumber,
        routingNumber: treasuryRouting,
        iban: generateIban(treasuryNumber, treasuryRouting),
        balanceCents: 4250000,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'accounts');
  }

  if (hasAccounts) {
    const primaryAcc = existingAccounts.find((a) => a.accountType === 'checking') ?? existingAccounts[0];
    for (const acc of existingAccounts) {
      await syncAccountDirectoryEntries({
        account: acc,
        displayName,
        handle,
        email,
        includeHandleAndEmail: acc.id === primaryAcc.id,
      });
    }
    return;
  }

  await syncAccountDirectoryEntries({
    account: {
      id: checkingId,
      userId: user.uid,
      name: 'Operating Checking',
      accountNumber: checkingNumber,
      currency: 'USD',
      status: 'active',
    },
    displayName,
    handle,
    email,
    includeHandleAndEmail: true,
  });

  await syncAccountDirectoryEntries({
    account: {
      id: treasuryId,
      userId: user.uid,
      name: 'Treasury Reserve',
      accountNumber: treasuryNumber,
      currency: 'USD',
      status: 'active',
    },
    displayName,
    handle,
    email,
    includeHandleAndEmail: false,
  });

  // Batch 2: Starter ledger transactions, open payment requests, beneficiaries, cards, and scheduled bills
  try {
    const batch2 = writeBatch(db);

    const starterTransactions = [
      {
        id: generateShortId('tx'),
        accountId: checkingId,
        direction: 'credit',
        txType: 'payment_received',
        amountCents: 640000,
        counterpartyName: 'Meridian Architecture Studio',
        counterpartyDetail: 'ACH Credit ···· 8814',
        category: 'Client Invoice',
        referenceCode: generateReferenceCode('INV'),
        memo: 'Q4 Advisory & Systems Retainer',
        status: 'settled',
      },
      {
        id: generateShortId('tx'),
        accountId: checkingId,
        direction: 'credit',
        txType: 'wire_in',
        amountCents: 325000,
        counterpartyName: 'Vanguard Payroll Clearing',
        counterpartyDetail: 'Fedwire #021000021',
        category: 'Direct Deposit',
        referenceCode: generateReferenceCode('WIR'),
        memo: 'Bi-weekly executive distribution',
        status: 'settled',
      },
      {
        id: generateShortId('tx'),
        accountId: checkingId,
        direction: 'debit',
        txType: 'bill_pay',
        amountCents: 184500,
        counterpartyName: 'Northstar Cloud Infrastructure',
        counterpartyDetail: 'ACH Debit ···· 4490',
        category: 'Cloud & Software',
        referenceCode: generateReferenceCode('BIL'),
        memo: 'Production compute cluster',
        status: 'settled',
      },
      {
        id: generateShortId('tx'),
        accountId: checkingId,
        direction: 'debit',
        txType: 'card_spend',
        amountCents: 32850,
        counterpartyName: 'Delta Air Lines',
        counterpartyDetail: 'Visa •••• 4821',
        category: 'Travel',
        referenceCode: generateReferenceCode('CRD'),
        memo: 'Client onsite travel',
        status: 'settled',
      },
      {
        id: generateShortId('tx'),
        accountId: treasuryId,
        direction: 'credit',
        txType: 'deposit',
        amountCents: 1500000,
        counterpartyName: 'Treasury Sweep Settlement',
        counterpartyDetail: 'Internal Reserve Allocation',
        category: 'Treasury Yield',
        referenceCode: generateReferenceCode('TRS'),
        memo: 'Automated cash reserve allocation',
        status: 'settled',
      },
    ];

    for (const tx of starterTransactions) {
      batch2.set(doc(db, 'transactions', tx.id), {
        id: tx.id,
        userId: user.uid,
        accountId: tx.accountId,
        direction: tx.direction,
        txType: tx.txType,
        amountCents: tx.amountCents,
        currency: 'USD',
        counterpartyName: tx.counterpartyName,
        counterpartyDetail: tx.counterpartyDetail,
        category: tx.category,
        referenceCode: tx.referenceCode,
        memo: tx.memo,
        status: tx.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const req1Id = generateShortId('req');
    batch2.set(doc(db, 'paymentRequests', req1Id), {
      id: req1Id,
      userId: user.uid,
      accountId: checkingId,
      title: 'Invoice #1042 — Product Strategy Retainer',
      payerName: 'Caspian Logistics Group',
      payerEmail: 'ap@caspianlogistics.example',
      amountCents: 285000,
      currency: 'USD',
      memo: 'November sprint milestone settlement',
      referenceCode: generateReferenceCode('REQ'),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const req2Id = generateShortId('req');
    batch2.set(doc(db, 'paymentRequests', req2Id), {
      id: req2Id,
      userId: user.uid,
      accountId: treasuryId,
      title: 'Equipment Lease Reimbursement',
      payerName: 'Harbor & Finch Partners',
      payerEmail: 'finance@harborfinch.example',
      amountCents: 92000,
      currency: 'USD',
      memo: 'Shared studio hardware reimbursement',
      referenceCode: generateReferenceCode('REQ'),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const ben1Id = generateShortId('ben');
    batch2.set(doc(db, 'beneficiaries', ben1Id), {
      id: ben1Id,
      userId: user.uid,
      name: 'Northstar Cloud Services',
      bankName: 'Silicon Commercial Bank',
      routingNumber: '121000358',
      accountLast4: '4490',
      accountType: 'checking',
      email: 'billing@northstarcloud.example',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const ben2Id = generateShortId('ben');
    batch2.set(doc(db, 'beneficiaries', ben2Id), {
      id: ben2Id,
      userId: user.uid,
      name: 'Alder & Co. Design Studio',
      bankName: 'First Republic Commercial',
      routingNumber: '021000021',
      accountLast4: '9102',
      accountType: 'wire',
      email: 'accounts@alderstudio.example',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const card1Id = generateShortId('crd');
    batch2.set(doc(db, 'cards', card1Id), {
      id: card1Id,
      userId: user.uid,
      accountId: checkingId,
      label: 'Operations & Travel',
      holderName: displayName,
      last4: '4821',
      expiry: '09/29',
      network: 'Visa',
      monthlyLimitCents: 500000,
      spentThisMonthCents: 32850,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const card2Id = generateShortId('crd');
    batch2.set(doc(db, 'cards', card2Id), {
      id: card2Id,
      userId: user.uid,
      accountId: checkingId,
      label: 'Software Subscriptions',
      holderName: displayName,
      last4: '7319',
      expiry: '04/30',
      network: 'Mastercard',
      monthlyLimitCents: 250000,
      spentThisMonthCents: 64000,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const todayPlus14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const sp1Id = generateShortId('sch');
    batch2.set(doc(db, 'scheduledPayments', sp1Id), {
      id: sp1Id,
      userId: user.uid,
      accountId: checkingId,
      payeeName: 'Northstar Cloud Services',
      category: 'Cloud & Software',
      amountCents: 184500,
      currency: 'USD',
      cadence: 'monthly',
      nextDueDate: todayPlus7,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const sp2Id = generateShortId('sch');
    batch2.set(doc(db, 'scheduledPayments', sp2Id), {
      id: sp2Id,
      userId: user.uid,
      accountId: checkingId,
      payeeName: 'Metro Fiber Utilities',
      category: 'Utilities',
      amountCents: 24000,
      currency: 'USD',
      cadence: 'monthly',
      nextDueDate: todayPlus14,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'transactions');
  }
}

export async function receiveFundsDeposit(params: {
  userId: string;
  accountId: string;
  amountCents: number;
  senderName: string;
  senderDetail: string;
  txType: Extract<TxType, 'deposit' | 'payment_received' | 'wire_in'>;
  category: string;
  memo: string;
  pendingOnly?: boolean;
}): Promise<string> {
  const txId = generateShortId('tx');
  const referenceCode = generateReferenceCode('RCV');
  const accountRef = doc(db, 'accounts', params.accountId);
  const txRef = doc(db, 'transactions', txId);

  try {
    await runTransaction(db, async (transaction) => {
      const accSnap = await transaction.get(accountRef);
      if (!accSnap.exists()) {
        throw new Error('Destination bank account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.userId !== params.userId) {
        throw new Error('Unauthorized account access.');
      }
      if (acc.status !== 'active') {
        throw new Error('Account is currently frozen. Select an active account or contact an administrator.');
      }

      if (!params.pendingOnly) {
        transaction.update(accountRef, {
          balanceCents: acc.balanceCents + params.amountCents,
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(txRef, {
        id: txId,
        userId: params.userId,
        accountId: params.accountId,
        direction: 'credit',
        txType: params.txType,
        amountCents: params.amountCents,
        currency: acc.currency,
        counterpartyName: sanitizeString(params.senderName, BLUEPRINT_LIMITS.PARTY_MAX),
        counterpartyDetail: sanitizeString(params.senderDetail, BLUEPRINT_LIMITS.EMAIL_MAX),
        category: sanitizeString(params.category, BLUEPRINT_LIMITS.CATEGORY_MAX),
        referenceCode,
        memo: sanitizeString(params.memo, BLUEPRINT_LIMITS.MEMO_MAX),
        status: params.pendingOnly ? 'pending' : 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `accounts/${params.accountId}`);
  }
}

export async function createPaymentRequest(params: {
  userId: string;
  accountId: string;
  title: string;
  payerName: string;
  payerEmail: string;
  amountCents: number;
  currency: CurrencyCode;
  memo: string;
}): Promise<string> {
  const id = generateShortId('req');
  const referenceCode = generateReferenceCode('REQ');
  const path = `paymentRequests/${id}`;

  try {
    await setDoc(doc(db, 'paymentRequests', id), {
      id,
      userId: params.userId,
      accountId: params.accountId,
      title: sanitizeString(params.title, BLUEPRINT_LIMITS.TITLE_MAX),
      payerName: sanitizeString(params.payerName, BLUEPRINT_LIMITS.PARTY_MAX),
      payerEmail: sanitizeString(params.payerEmail, BLUEPRINT_LIMITS.EMAIL_MAX),
      amountCents: params.amountCents,
      currency: params.currency,
      memo: sanitizeString(params.memo, BLUEPRINT_LIMITS.MEMO_MAX),
      referenceCode,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function settlePaymentRequest(params: {
  userId: string;
  requestId: string;
}): Promise<string> {
  const reqRef = doc(db, 'paymentRequests', params.requestId);
  const txId = generateShortId('tx');
  const txRef = doc(db, 'transactions', txId);

  try {
    let refCode = '';
    await runTransaction(db, async (transaction) => {
      const reqSnap = await transaction.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error('Payment request not found.');
      }
      const req = reqSnap.data() as PaymentRequest;
      if (req.userId !== params.userId) {
        throw new Error('Unauthorized access to payment request.');
      }
      if (req.status !== 'pending') {
        throw new Error('This payment request is already finalized.');
      }

      const accRef = doc(db, 'accounts', req.accountId);
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Target deposit account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Target account is frozen. Select an active account or contact an administrator.');
      }

      refCode = req.referenceCode;

      transaction.update(reqRef, {
        status: 'paid',
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.update(accRef, {
        balanceCents: acc.balanceCents + req.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        userId: params.userId,
        accountId: req.accountId,
        direction: 'credit',
        txType: 'payment_received',
        amountCents: req.amountCents,
        currency: acc.currency,
        counterpartyName: req.payerName,
        counterpartyDetail: req.payerEmail || `Payment Link ${req.referenceCode}`,
        category: 'Payment Request',
        referenceCode: req.referenceCode,
        memo: req.memo || req.title,
        status: 'settled',
        paymentRequestId: req.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return refCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `paymentRequests/${params.requestId}`);
  }
}

export async function cancelPaymentRequest(requestId: string): Promise<void> {
  const path = `paymentRequests/${requestId}`;
  try {
    await updateDoc(doc(db, 'paymentRequests', requestId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function executeInternalTransfer(params: {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  memo: string;
}): Promise<string> {
  if (params.fromAccountId === params.toAccountId) {
    throw new Error('Select two different accounts for an internal transfer.');
  }

  const fromRef = doc(db, 'accounts', params.fromAccountId);
  const toRef = doc(db, 'accounts', params.toAccountId);
  const debitTxId = generateShortId('tx');
  const creditTxId = generateShortId('tx');
  const referenceCode = generateReferenceCode('INT');

  try {
    await runTransaction(db, async (transaction) => {
      const fromSnap = await transaction.get(fromRef);
      const toSnap = await transaction.get(toRef);
      if (!fromSnap.exists() || !toSnap.exists()) {
        throw new Error('Selected account could not be found.');
      }
      const fromAcc = fromSnap.data() as BankAccount;
      const toAcc = toSnap.data() as BankAccount;

      if (fromAcc.userId !== params.userId || toAcc.userId !== params.userId) {
        throw new Error('Unauthorized account transfer.');
      }
      if (fromAcc.status !== 'active' || toAcc.status !== 'active') {
        throw new Error('Both source and destination accounts must be active.');
      }
      if (fromAcc.currency !== toAcc.currency) {
        throw new Error(`Currency mismatch (${fromAcc.currency} to ${toAcc.currency}). Select matching currency accounts.`);
      }
      if (fromAcc.balanceCents < params.amountCents) {
        throw new Error('Insufficient available balance in source account.');
      }

      transaction.update(fromRef, {
        balanceCents: fromAcc.balanceCents - params.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.update(toRef, {
        balanceCents: toAcc.balanceCents + params.amountCents,
        updatedAt: serverTimestamp(),
      });

      const memoText = sanitizeString(params.memo || `Transfer to ${toAcc.name}`, BLUEPRINT_LIMITS.MEMO_MAX);

      transaction.set(doc(db, 'transactions', debitTxId), {
        id: debitTxId,
        userId: params.userId,
        accountId: fromAcc.id,
        direction: 'debit',
        txType: 'internal_transfer',
        amountCents: params.amountCents,
        currency: fromAcc.currency,
        counterpartyName: toAcc.name,
        counterpartyDetail: `Internal ···· ${toAcc.accountNumber.slice(-4)}`,
        category: 'Internal Transfer',
        referenceCode,
        memo: memoText,
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'transactions', creditTxId), {
        id: creditTxId,
        userId: params.userId,
        accountId: toAcc.id,
        direction: 'credit',
        txType: 'internal_transfer',
        amountCents: params.amountCents,
        currency: toAcc.currency,
        counterpartyName: fromAcc.name,
        counterpartyDetail: `Internal ···· ${fromAcc.accountNumber.slice(-4)}`,
        category: 'Internal Transfer',
        referenceCode,
        memo: memoText,
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `accounts/${params.fromAccountId}`);
  }
}

export async function executeExternalTransfer(params: {
  userId: string;
  accountId: string;
  recipientName: string;
  recipientDetail: string;
  amountCents: number;
  txType: Extract<TxType, 'transfer_out' | 'bill_pay'>;
  category: string;
  memo: string;
}): Promise<string> {
  const accountRef = doc(db, 'accounts', params.accountId);
  const txId = generateShortId('tx');
  const txRef = doc(db, 'transactions', txId);
  const referenceCode = generateReferenceCode(params.txType === 'bill_pay' ? 'BIL' : 'ACH');

  const userRef = doc(db, 'users', params.userId);

  try {
    await runTransaction(db, async (transaction) => {
      const [userSnap, accSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(accountRef),
      ]);
      if (!userSnap.exists() || (userSnap.data() as UserProfile).withdrawalFrozen !== false) {
        throw new Error(WITHDRAWAL_FROZEN_MESSAGE);
      }
      if (!accSnap.exists()) {
        throw new Error('Source bank account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.userId !== params.userId) {
        throw new Error('Unauthorized account access.');
      }
      if (acc.status !== 'active') {
        throw new Error('Source account is frozen. Select an active account or contact an administrator.');
      }
      if (acc.balanceCents < params.amountCents) {
        throw new Error('Insufficient available balance for this transfer.');
      }

      transaction.update(accountRef, {
        balanceCents: acc.balanceCents - params.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        userId: params.userId,
        accountId: acc.id,
        direction: 'debit',
        txType: params.txType,
        amountCents: params.amountCents,
        currency: acc.currency,
        counterpartyName: sanitizeString(params.recipientName, BLUEPRINT_LIMITS.PARTY_MAX),
        counterpartyDetail: sanitizeString(params.recipientDetail, BLUEPRINT_LIMITS.EMAIL_MAX),
        category: sanitizeString(params.category, BLUEPRINT_LIMITS.CATEGORY_MAX),
        referenceCode,
        memo: sanitizeString(params.memo, BLUEPRINT_LIMITS.MEMO_MAX),
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `accounts/${params.accountId}`);
  }
}

export async function settlePendingTransaction(userId: string, txId: string): Promise<void> {
  const txRef = doc(db, 'transactions', txId);

  try {
    await runTransaction(db, async (transaction) => {
      const txSnap = await transaction.get(txRef);
      if (!txSnap.exists()) {
        throw new Error('Transaction not found.');
      }
      const ledgerTx = txSnap.data() as LedgerTransaction;
      if (ledgerTx.userId !== userId) {
        throw new Error('Unauthorized.');
      }
      if (ledgerTx.status !== 'pending') {
        throw new Error('Only pending transactions can be settled.');
      }

      const isFrozenBlockedDebit =
        ledgerTx.direction === 'debit' &&
        (ledgerTx.txType === 'transfer_out' ||
          ledgerTx.txType === 'bill_pay' ||
          ledgerTx.txType === 'card_spend' ||
          ledgerTx.txType === 'p2p_transfer');

      const accRef = doc(db, 'accounts', ledgerTx.accountId);
      const userRef = doc(db, 'users', userId);
      const [userSnap, accSnap] = await Promise.all([
        isFrozenBlockedDebit ? transaction.get(userRef) : Promise.resolve(null),
        transaction.get(accRef),
      ]);
      if (isFrozenBlockedDebit && (!userSnap?.exists() || (userSnap.data() as UserProfile).withdrawalFrozen !== false)) {
        throw new Error(WITHDRAWAL_FROZEN_MESSAGE);
      }
      if (!accSnap.exists()) {
        throw new Error('Account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Account is frozen. Contact an administrator before settling.');
      }

      const nextBalance =
        ledgerTx.direction === 'credit'
          ? acc.balanceCents + ledgerTx.amountCents
          : acc.balanceCents - ledgerTx.amountCents;

      if (nextBalance < 0) {
        throw new Error('Insufficient funds to settle this pending debit.');
      }

      transaction.update(accRef, {
        balanceCents: nextBalance,
        updatedAt: serverTimestamp(),
      });

      transaction.update(txRef, {
        status: 'settled',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `transactions/${txId}`);
  }
}

export async function cancelPendingTransaction(txId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'transactions', txId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `transactions/${txId}`);
  }
}

export async function createBankAccount(params: {
  userId: string;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
}): Promise<string> {
  const id = generateShortId('acc');
  const accountNumber = generateAccountNumber();
  const routingNumber = generateRoutineNumber();
  const iban = generateIban(accountNumber, routingNumber);
  const cleanedName = sanitizeString(params.name, BLUEPRINT_LIMITS.NAME_MAX);

  try {
    await setDoc(doc(db, 'accounts', id), {
      id,
      userId: params.userId,
      name: cleanedName,
      accountType: params.accountType,
      currency: params.currency,
      accountNumber,
      routingNumber,
      iban,
      balanceCents: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncDirectoryForAccountId(id);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `accounts/${id}`);
  }
}

export async function toggleAccountStatus(accountId: string, nextStatus: AccountStatus): Promise<void> {
  try {
    await updateDoc(doc(db, 'accounts', accountId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    await syncDirectoryForAccountId(accountId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `accounts/${accountId}`);
  }
}

export async function renameBankAccount(accountId: string, name: string): Promise<void> {
  const cleaned = sanitizeString(name, BLUEPRINT_LIMITS.NAME_MAX);
  if (cleaned.length < BLUEPRINT_LIMITS.NAME_MIN) {
    throw new Error('Account name must be at least 2 characters.');
  }
  try {
    await updateDoc(doc(db, 'accounts', accountId), {
      name: cleaned,
      updatedAt: serverTimestamp(),
    });
    await syncDirectoryForAccountId(accountId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `accounts/${accountId}`);
  }
}

export async function createBeneficiary(params: {
  userId: string;
  name: string;
  bankName: string;
  routingNumber: string;
  accountLast4: string;
  accountType: BeneficiaryAccountType;
  email: string;
}): Promise<string> {
  const id = generateShortId('ben');
  try {
    await setDoc(doc(db, 'beneficiaries', id), {
      id,
      userId: params.userId,
      name: sanitizeString(params.name, BLUEPRINT_LIMITS.PARTY_MAX),
      bankName: sanitizeString(params.bankName, BLUEPRINT_LIMITS.PARTY_MAX),
      routingNumber: params.routingNumber.trim(),
      accountLast4: params.accountLast4.trim(),
      accountType: params.accountType,
      email: sanitizeString(params.email, BLUEPRINT_LIMITS.EMAIL_MAX),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `beneficiaries/${id}`);
  }
}

export async function deleteBeneficiary(beneficiaryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'beneficiaries', beneficiaryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `beneficiaries/${beneficiaryId}`);
  }
}

export async function issueVirtualCard(params: {
  userId: string;
  accountId: string;
  label: string;
  holderName: string;
  network: CardNetwork;
  monthlyLimitCents: number;
}): Promise<string> {
  const id = generateShortId('crd');
  const last4 = Math.floor(1000 + Math.random() * 9000).toString();
  const month = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
  const expiry = `${month}/30`;

  const cleanedHolder = sanitizeString(params.holderName, BLUEPRINT_LIMITS.PARTY_MAX);
  const safeHolderName = cleanedHolder.length >= BLUEPRINT_LIMITS.NAME_MIN ? cleanedHolder : 'Account Holder';

  try {
    await setDoc(doc(db, 'cards', id), {
      id,
      userId: params.userId,
      accountId: params.accountId,
      label: sanitizeString(params.label, BLUEPRINT_LIMITS.CARD_LABEL_MAX),
      holderName: safeHolderName,
      last4,
      expiry,
      network: params.network,
      monthlyLimitCents: params.monthlyLimitCents,
      spentThisMonthCents: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `cards/${id}`);
  }
}

export async function toggleCardStatus(cardId: string, nextStatus: CardStatus): Promise<void> {
  try {
    await updateDoc(doc(db, 'cards', cardId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `cards/${cardId}`);
  }
}

export async function updateCardLimit(cardId: string, monthlyLimitCents: number): Promise<void> {
  try {
    await updateDoc(doc(db, 'cards', cardId), {
      monthlyLimitCents,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `cards/${cardId}`);
  }
}

export async function recordCardPurchase(params: {
  userId: string;
  cardId: string;
  merchantName: string;
  category: string;
  amountCents: number;
}): Promise<string> {
  const cardRef = doc(db, 'cards', params.cardId);
  const txId = generateShortId('tx');
  const txRef = doc(db, 'transactions', txId);
  const referenceCode = generateReferenceCode('CRD');

  const userRef = doc(db, 'users', params.userId);

  try {
    await runTransaction(db, async (transaction) => {
      const [userSnap, cardSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(cardRef),
      ]);
      if (!userSnap.exists() || (userSnap.data() as UserProfile).withdrawalFrozen !== false) {
        throw new Error(WITHDRAWAL_FROZEN_MESSAGE);
      }
      if (!cardSnap.exists()) {
        throw new Error('Card not found.');
      }
      const card = cardSnap.data() as VirtualCard;
      if (card.userId !== params.userId) {
        throw new Error('Unauthorized card access.');
      }
      if (card.status !== 'active') {
        throw new Error('This card is frozen. Unfreeze it before authorizing a purchase.');
      }
      if (card.spentThisMonthCents + params.amountCents > card.monthlyLimitCents) {
        throw new Error('Purchase exceeds this card’s monthly spending limit.');
      }

      const accRef = doc(db, 'accounts', card.accountId);
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Linked account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Linked bank account is frozen.');
      }
      if (acc.balanceCents < params.amountCents) {
        throw new Error('Insufficient balance in linked bank account.');
      }

      transaction.update(cardRef, {
        spentThisMonthCents: card.spentThisMonthCents + params.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.update(accRef, {
        balanceCents: acc.balanceCents - params.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        userId: params.userId,
        accountId: acc.id,
        direction: 'debit',
        txType: 'card_spend',
        amountCents: params.amountCents,
        currency: acc.currency,
        counterpartyName: sanitizeString(params.merchantName, BLUEPRINT_LIMITS.PARTY_MAX),
        counterpartyDetail: `${card.network} •••• ${card.last4}`,
        category: sanitizeString(params.category, BLUEPRINT_LIMITS.CATEGORY_MAX),
        referenceCode,
        memo: `Card authorization (${card.label})`,
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `cards/${params.cardId}`);
  }
}

export async function createScheduledPayment(params: {
  userId: string;
  accountId: string;
  payeeName: string;
  category: string;
  amountCents: number;
  currency: CurrencyCode;
  cadence: ScheduledCadence;
  nextDueDate: string;
}): Promise<string> {
  const id = generateShortId('sch');
  try {
    await setDoc(doc(db, 'scheduledPayments', id), {
      id,
      userId: params.userId,
      accountId: params.accountId,
      payeeName: sanitizeString(params.payeeName, BLUEPRINT_LIMITS.PARTY_MAX),
      category: sanitizeString(params.category, BLUEPRINT_LIMITS.CATEGORY_MAX),
      amountCents: params.amountCents,
      currency: params.currency,
      cadence: params.cadence,
      nextDueDate: params.nextDueDate,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `scheduledPayments/${id}`);
  }
}

export async function executeScheduledPaymentNow(
  userId: string,
  scheduledId: string
): Promise<string> {
  const spRef = doc(db, 'scheduledPayments', scheduledId);
  const txId = generateShortId('tx');
  const txRef = doc(db, 'transactions', txId);
  const referenceCode = generateReferenceCode('BIL');

  const userRef = doc(db, 'users', userId);

  try {
    await runTransaction(db, async (transaction) => {
      const [userSnap, spSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(spRef),
      ]);
      if (!userSnap.exists() || (userSnap.data() as UserProfile).withdrawalFrozen !== false) {
        throw new Error(WITHDRAWAL_FROZEN_MESSAGE);
      }
      if (!spSnap.exists()) {
        throw new Error('Scheduled payment not found.');
      }
      const sp = spSnap.data() as ScheduledPayment;
      if (sp.userId !== userId) {
        throw new Error('Unauthorized.');
      }
      if (sp.status !== 'scheduled') {
        throw new Error('Scheduled payment is no longer active.');
      }

      const accRef = doc(db, 'accounts', sp.accountId);
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Linked account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Source account is frozen.');
      }
      if (acc.balanceCents < sp.amountCents) {
        throw new Error('Insufficient balance in source account.');
      }

      transaction.update(accRef, {
        balanceCents: acc.balanceCents - sp.amountCents,
        updatedAt: serverTimestamp(),
      });

      if (sp.cadence === 'once') {
        transaction.update(spRef, {
          status: 'completed',
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(spRef, {
          nextDueDate: advanceDateString(sp.nextDueDate, sp.cadence),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(txRef, {
        id: txId,
        userId,
        accountId: acc.id,
        direction: 'debit',
        txType: 'bill_pay',
        amountCents: sp.amountCents,
        currency: acc.currency,
        counterpartyName: sp.payeeName,
        counterpartyDetail: `Scheduled Bill Pay (${sp.cadence})`,
        category: sp.category,
        referenceCode,
        memo: `Scheduled payment execution`,
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `scheduledPayments/${scheduledId}`);
  }
}

export async function cancelScheduledPayment(scheduledId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'scheduledPayments', scheduledId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `scheduledPayments/${scheduledId}`);
  }
}

// --- Peer-to-Peer Recipient Resolution & Atomic Cross-User Transfers ---

export async function resolveTransferRecipient(rawQuery: string): Promise<RecipientDirectoryEntry | null> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;

  let lookupKey = '';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    const hash = await sha256Hex(trimmed);
    lookupKey = `eml_${hash}`;
  } else if (/^[0-9]{10,12}$/.test(trimmed)) {
    lookupKey = `num_${trimmed}`;
  } else {
    lookupKey = normalizeHandleLookupKey(trimmed);
  }

  if (
    lookupKey.length < 4 ||
    lookupKey.length > 80 ||
    !BLUEPRINT_LIMITS.LOOKUP_KEY_REGEX.test(lookupKey)
  ) {
    return null;
  }

  try {
    const snap = await getDoc(doc(db, 'recipientDirectory', lookupKey));
    if (!snap.exists()) return null;
    return snap.data() as RecipientDirectoryEntry;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `recipientDirectory/${lookupKey}`);
  }
}

export async function executePeerTransfer(params: {
  fromUserId: string;
  fromUserDisplayName: string;
  fromUserHandle: string;
  fromAccountId: string;
  toRecipient: RecipientDirectoryEntry;
  amountCents: number;
  memo: string;
}): Promise<string> {
  if (params.fromAccountId === params.toRecipient.accountId) {
    throw new Error('Source and recipient accounts must be different.');
  }
  if (params.toRecipient.status !== 'active') {
    throw new Error('Recipient account is currently frozen and cannot receive transfers.');
  }

  const transferId = generateShortId('ptx');
  const debitTxId = generateShortId('tx');
  const creditTxId = generateShortId('tx');
  const referenceCode = generateReferenceCode('P2P');

  const fromRef = doc(db, 'accounts', params.fromAccountId);
  const toRef = doc(db, 'accounts', params.toRecipient.accountId);
  const transferRef = doc(db, 'peerTransfers', transferId);
  const memoText = sanitizeString(
    params.memo || `Transfer to ${params.toRecipient.displayName}`,
    BLUEPRINT_LIMITS.MEMO_MAX
  );

  const userRef = doc(db, 'users', params.fromUserId);

  try {
    await runTransaction(db, async (transaction) => {
      const [userSnap, fromSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(fromRef),
      ]);
      if (!userSnap.exists() || (userSnap.data() as UserProfile).withdrawalFrozen !== false) {
        throw new Error(WITHDRAWAL_FROZEN_MESSAGE);
      }
      if (!fromSnap.exists()) {
        throw new Error('Source bank account not found.');
      }
      const fromAcc = fromSnap.data() as BankAccount;
      if (fromAcc.userId !== params.fromUserId) {
        throw new Error('Unauthorized source account.');
      }
      if (fromAcc.status !== 'active') {
        throw new Error('Source account is frozen. Select an active account or contact an administrator.');
      }
      if (fromAcc.currency !== params.toRecipient.currency) {
        throw new Error(
          `Currency mismatch (${fromAcc.currency} to ${params.toRecipient.currency}). Accounts must share the same currency.`
        );
      }
      if (fromAcc.balanceCents < params.amountCents) {
        throw new Error('Insufficient available balance in source account.');
      }

      transaction.update(fromRef, {
        balanceCents: fromAcc.balanceCents - params.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.update(toRef, {
        balanceCents: increment(params.amountCents),
        lastTransferId: transferId,
        updatedAt: serverTimestamp(),
      });

      transaction.set(transferRef, {
        id: transferId,
        fromUserId: params.fromUserId,
        fromAccountId: fromAcc.id,
        toUserId: params.toRecipient.userId,
        toAccountId: params.toRecipient.accountId,
        amountCents: params.amountCents,
        currency: fromAcc.currency,
        referenceCode,
        memo: memoText,
        createdAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'transactions', debitTxId), {
        id: debitTxId,
        userId: params.fromUserId,
        accountId: fromAcc.id,
        direction: 'debit',
        txType: 'p2p_transfer',
        amountCents: params.amountCents,
        currency: fromAcc.currency,
        counterpartyName: sanitizeString(params.toRecipient.displayName, BLUEPRINT_LIMITS.PARTY_MAX),
        counterpartyDetail: sanitizeString(
          `${params.toRecipient.handle} ···· ${params.toRecipient.accountLast4}`,
          BLUEPRINT_LIMITS.EMAIL_MAX
        ),
        category: 'Peer Transfer',
        referenceCode,
        memo: memoText,
        status: 'settled',
        peerTransferId: transferId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'transactions', creditTxId), {
        id: creditTxId,
        userId: params.toRecipient.userId,
        accountId: params.toRecipient.accountId,
        direction: 'credit',
        txType: 'p2p_transfer',
        amountCents: params.amountCents,
        currency: params.toRecipient.currency,
        counterpartyName: sanitizeString(params.fromUserDisplayName, BLUEPRINT_LIMITS.PARTY_MAX),
        counterpartyDetail: sanitizeString(
          `${params.fromUserHandle} ···· ${fromAcc.accountNumber.slice(-4)}`,
          BLUEPRINT_LIMITS.EMAIL_MAX
        ),
        category: 'Peer Transfer',
        referenceCode,
        memo: memoText,
        status: 'settled',
        peerTransferId: transferId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `peerTransfers/${transferId}`);
  }
}

// --- Admin Role Verification & System Governance Operations ---

export async function checkIsAdmin(user: User): Promise<boolean> {
  if (!user.emailVerified) {
    return false;
  }
  if (user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return false;
    }
    handleFirestoreError(err, OperationType.GET, `admins/${user.uid}`);
  }
}

export async function adminTopUpAccount(params: {
  adminUserId: string;
  adminName: string;
  targetAccountId: string;
  amountCents: number;
  fundingMode: AdminTopUpFundingMode;
  sourceAdminAccountId?: string;
  memo: string;
}): Promise<string> {
  if (params.amountCents <= 0 || params.amountCents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
    throw new Error('Top-up amount exceeds allowed limits.');
  }

  const targetRef = doc(db, 'accounts', params.targetAccountId);
  const referenceCode = generateReferenceCode('ADM');
  const creditTxId = generateShortId('tx');
  const memoText = sanitizeString(params.memo || 'Admin balance top-up', BLUEPRINT_LIMITS.MEMO_MAX);

  try {
    await runTransaction(db, async (transaction) => {
      const targetSnap = await transaction.get(targetRef);
      if (!targetSnap.exists()) {
        throw new Error('Target bank account not found.');
      }
      const targetAcc = targetSnap.data() as BankAccount;
      if (targetAcc.status !== 'active') {
        throw new Error('Target account is frozen. Unfreeze it before initiating a top-up.');
      }

      if (params.fundingMode === 'admin_account_debit') {
        if (!params.sourceAdminAccountId) {
          throw new Error('Select a funding admin bank account.');
        }
        if (params.sourceAdminAccountId === params.targetAccountId) {
          throw new Error('Source admin account and target account must be different.');
        }

        const sourceRef = doc(db, 'accounts', params.sourceAdminAccountId);
        const sourceSnap = await transaction.get(sourceRef);
        if (!sourceSnap.exists()) {
          throw new Error('Selected admin funding account not found.');
        }
        const sourceAcc = sourceSnap.data() as BankAccount;
        if (sourceAcc.userId !== params.adminUserId) {
          throw new Error('Funding source must belong to your admin profile.');
        }
        if (sourceAcc.status !== 'active') {
          throw new Error('Selected admin funding account is frozen.');
        }
        if (sourceAcc.currency !== targetAcc.currency) {
          throw new Error(
            `Currency mismatch (${sourceAcc.currency} vs ${targetAcc.currency}). Select a matching currency account.`
          );
        }
        if (sourceAcc.balanceCents < params.amountCents) {
          throw new Error('Insufficient balance in selected admin funding account.');
        }

        const debitTxId = generateShortId('tx');

        transaction.update(sourceRef, {
          balanceCents: sourceAcc.balanceCents - params.amountCents,
          updatedAt: serverTimestamp(),
        });

        transaction.update(targetRef, {
          balanceCents: targetAcc.balanceCents + params.amountCents,
          updatedAt: serverTimestamp(),
        });

        transaction.set(doc(db, 'transactions', debitTxId), {
          id: debitTxId,
          userId: params.adminUserId,
          accountId: sourceAcc.id,
          direction: 'debit',
          txType: 'admin_top_up',
          amountCents: params.amountCents,
          currency: sourceAcc.currency,
          counterpartyName: sanitizeString(targetAcc.name, BLUEPRINT_LIMITS.PARTY_MAX),
          counterpartyDetail: `Admin Top-Up ···· ${targetAcc.accountNumber.slice(-4)}`,
          category: 'Admin Top-Up',
          referenceCode,
          memo: memoText,
          status: 'settled',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(doc(db, 'transactions', creditTxId), {
          id: creditTxId,
          userId: targetAcc.userId,
          accountId: targetAcc.id,
          direction: 'credit',
          txType: 'admin_top_up',
          amountCents: params.amountCents,
          currency: targetAcc.currency,
          counterpartyName: sanitizeString(params.adminName || 'Kestrel Admin', BLUEPRINT_LIMITS.PARTY_MAX),
          counterpartyDetail: `Funded from ${sourceAcc.name}`,
          category: 'Admin Top-Up',
          referenceCode,
          memo: memoText,
          status: 'settled',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        // System Treasury Issuance
        transaction.update(targetRef, {
          balanceCents: targetAcc.balanceCents + params.amountCents,
          updatedAt: serverTimestamp(),
        });

        transaction.set(doc(db, 'transactions', creditTxId), {
          id: creditTxId,
          userId: targetAcc.userId,
          accountId: targetAcc.id,
          direction: 'credit',
          txType: 'admin_top_up',
          amountCents: params.amountCents,
          currency: targetAcc.currency,
          counterpartyName: 'Kestrel System Treasury',
          counterpartyDetail: `Issued by ${sanitizeString(params.adminName || PRIMARY_ADMIN_EMAIL, 60)}`,
          category: 'Treasury Issuance',
          referenceCode,
          memo: memoText,
          status: 'settled',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    return referenceCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `accounts/${params.targetAccountId}`);
  }
}

export async function adminCreateBankAccountForUser(params: {
  targetUser: UserProfile;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  initialBalanceCents: number;
}): Promise<string> {
  const id = generateShortId('acc');
  const accountNumber = generateAccountNumber();
  const routingNumber = generateRoutineNumber();
  const iban = generateIban(accountNumber, routingNumber);
  const cleanedName = sanitizeString(params.name, BLUEPRINT_LIMITS.NAME_MAX);
  if (cleanedName.length < BLUEPRINT_LIMITS.NAME_MIN) {
    throw new Error('Account name must be at least 2 characters.');
  }
  const openingCents = Math.max(0, Math.round(params.initialBalanceCents));
  if (openingCents > BLUEPRINT_LIMITS.MAX_AMOUNT_CENTS) {
    throw new Error('Opening balance cannot exceed $100,000,000.00.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'accounts', id), {
      id,
      userId: params.targetUser.uid,
      name: cleanedName,
      accountType: params.accountType,
      currency: params.currency,
      accountNumber,
      routingNumber,
      iban,
      balanceCents: openingCents,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (openingCents > 0) {
      const txId = generateShortId('tx');
      batch.set(doc(db, 'transactions', txId), {
        id: txId,
        userId: params.targetUser.uid,
        accountId: id,
        direction: 'credit',
        txType: 'admin_top_up',
        amountCents: openingCents,
        currency: params.currency,
        counterpartyName: 'Kestrel System Treasury',
        counterpartyDetail: 'Admin Opening Funding',
        category: 'Treasury Issuance',
        referenceCode: generateReferenceCode('ADM'),
        memo: `Opening balance for ${cleanedName}`,
        status: 'settled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await syncAccountDirectoryEntries({
      account: {
        id,
        userId: params.targetUser.uid,
        name: cleanedName,
        accountNumber,
        currency: params.currency,
        status: 'active',
      },
      displayName: params.targetUser.displayName,
      handle: params.targetUser.handle,
      email: params.targetUser.email,
      includeHandleAndEmail: false,
    });

    return id;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `accounts/${id}`);
  }
}

export async function adminSettlePendingTransaction(txId: string): Promise<void> {
  const txRef = doc(db, 'transactions', txId);

  try {
    await runTransaction(db, async (transaction) => {
      const txSnap = await transaction.get(txRef);
      if (!txSnap.exists()) {
        throw new Error('Transaction not found.');
      }
      const ledgerTx = txSnap.data() as LedgerTransaction;
      if (ledgerTx.status !== 'pending') {
        throw new Error('Only pending transactions can be settled.');
      }

      const accRef = doc(db, 'accounts', ledgerTx.accountId);
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Linked account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Account is frozen. Unfreeze it before settling.');
      }

      const nextBalance =
        ledgerTx.direction === 'credit'
          ? acc.balanceCents + ledgerTx.amountCents
          : acc.balanceCents - ledgerTx.amountCents;

      if (nextBalance < 0) {
        throw new Error('Insufficient funds to settle this pending debit.');
      }

      transaction.update(accRef, {
        balanceCents: nextBalance,
        updatedAt: serverTimestamp(),
      });

      transaction.update(txRef, {
        status: 'settled',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `transactions/${txId}`);
  }
}

export async function adminSettlePaymentRequest(requestId: string): Promise<string> {
  const reqRef = doc(db, 'paymentRequests', requestId);
  const txId = generateShortId('tx');
  const txRef = doc(db, 'transactions', txId);

  try {
    let refCode = '';
    await runTransaction(db, async (transaction) => {
      const reqSnap = await transaction.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error('Payment request not found.');
      }
      const req = reqSnap.data() as PaymentRequest;
      if (req.status !== 'pending') {
        throw new Error('This payment request is already finalized.');
      }

      const accRef = doc(db, 'accounts', req.accountId);
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Target deposit account not found.');
      }
      const acc = accSnap.data() as BankAccount;
      if (acc.status !== 'active') {
        throw new Error('Target account is frozen. Unfreeze it before settling.');
      }

      refCode = req.referenceCode;

      transaction.update(reqRef, {
        status: 'paid',
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.update(accRef, {
        balanceCents: acc.balanceCents + req.amountCents,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        userId: req.userId,
        accountId: req.accountId,
        direction: 'credit',
        txType: 'payment_received',
        amountCents: req.amountCents,
        currency: acc.currency,
        counterpartyName: req.payerName,
        counterpartyDetail: req.payerEmail || `Admin Settled ${req.referenceCode}`,
        category: 'Payment Request',
        referenceCode: req.referenceCode,
        memo: req.memo || req.title,
        status: 'settled',
        paymentRequestId: req.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return refCode;
  } catch (err) {
    if (err instanceof Error && !isPermissionDeniedError(err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `paymentRequests/${requestId}`);
  }
}

export async function adminGrantAdminAccess(params: {
  targetUser: UserProfile;
  grantedBy: string;
}): Promise<void> {
  const path = `admins/${params.targetUser.uid}`;
  try {
    await setDoc(doc(db, 'admins', params.targetUser.uid), {
      uid: params.targetUser.uid,
      email: sanitizeString(params.targetUser.email, BLUEPRINT_LIMITS.EMAIL_MAX),
      displayName: sanitizeString(params.targetUser.displayName, BLUEPRINT_LIMITS.PARTY_MAX),
      grantedBy: sanitizeString(params.grantedBy, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function adminRevokeAdminAccess(targetUid: string): Promise<void> {
  const path = `admins/${targetUid}`;
  try {
    await deleteDoc(doc(db, 'admins', targetUid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function adminSetUserWithdrawalFrozen(
  targetUid: string,
  frozen: boolean
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      withdrawalFrozen: frozen,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
