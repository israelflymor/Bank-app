import type { Timestamp } from 'firebase/firestore';

export const PRIMARY_ADMIN_EMAIL = 'stetons69@gmail.com';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP';
export type AccountType = 'checking' | 'savings' | 'treasury';
export type AccountStatus = 'active' | 'frozen';
export type TxDirection = 'credit' | 'debit';
export type TxType =
  | 'deposit'
  | 'payment_received'
  | 'wire_in'
  | 'transfer_out'
  | 'internal_transfer'
  | 'bill_pay'
  | 'card_spend'
  | 'p2p_transfer'
  | 'admin_top_up';
export type TxStatus = 'settled' | 'pending' | 'cancelled';
export type PaymentRequestStatus = 'pending' | 'paid' | 'cancelled';
export type BeneficiaryAccountType = 'checking' | 'savings' | 'wire';
export type CardNetwork = 'Visa' | 'Mastercard';
export type CardStatus = 'active' | 'frozen';
export type ScheduledCadence = 'once' | 'weekly' | 'monthly';
export type ScheduledStatus = 'scheduled' | 'completed' | 'cancelled';
export type AdminTopUpFundingMode = 'treasury_issuance' | 'admin_account_debit';

export type GenderOption = 'Male' | 'Female' | 'Other' | 'Prefer not to say';

export type ActiveNavSection =
  | 'overview'
  | 'receive'
  | 'transfers'
  | 'ledger'
  | 'cards'
  | 'beneficiaries'
  | 'admin';

// Blueprint Validation Bounds (synchronized with firebase-blueprint.json & firestore.rules)
export const BLUEPRINT_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 60,
  TITLE_MIN: 2,
  TITLE_MAX: 80,
  PARTY_MIN: 1,
  PARTY_MAX: 80,
  EMAIL_MAX: 120,
  CATEGORY_MAX: 40,
  MEMO_MAX: 160,
  CARD_LABEL_MAX: 50,
  ROUTING_REGEX: /^[0-9]{9}$/,
  BANK_ROUTING_REGEX: /^[0-9]{9,11}$/,
  ACCOUNT_NUMBER_REGEX: /^[0-9]{10,12}$/,
  DOB_REGEX: /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/,
  LAST4_REGEX: /^[0-9]{4}$/,
  HANDLE_REGEX: /^@[a-zA-Z0-9._-]+$/,
  LOOKUP_KEY_REGEX: /^[a-zA-Z0-9._-]+$/,
  DATE_REGEX: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  MAX_AMOUNT_CENTS: 10000000000,
  MIN_CARD_LIMIT_CENTS: 1000,
  MAX_CARD_LIMIT_CENTS: 1000000000,
} as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  handle: string;
  dateOfBirth?: string;
  gender?: GenderOption;
  primaryAccountNumber?: string;
  primaryRoutingNumber?: string;
  withdrawalFrozen?: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface MemberCredential {
  accountNumber: string;
  routingHash: string;
  claimProof: string;
  userId: string;
  claimedUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export const SEEDED_CHRISTOPHER_MASON = {
  seededUserId: 'member_0036028172',
  seededAccountId: 'acc_0036028172',
  displayName: 'Christopher Mason',
  dateOfBirth: '14/04/1984',
  gender: 'Male' as GenderOption,
  email: 'christopher.mason@kestrelbank.com',
  handle: '@christopher.mason',
  accountNumber: '0036028172',
  routingNumber: '08109289581',
} as const;

export const WITHDRAWAL_FROZEN_MESSAGE =
  'Withdrawal access is frozen. Contact an administrator to enable outgoing transfers and card spending.';

export function isWithdrawalAccessFrozen(profile: UserProfile | null | undefined): boolean {
  return profile?.withdrawalFrozen !== false;
}

export interface BankAccount {
  id: string;
  userId: string;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  accountNumber: string;
  routingNumber: string;
  iban: string;
  balanceCents: number;
  status: AccountStatus;
  lastTransferId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  accountId: string;
  direction: TxDirection;
  txType: TxType;
  amountCents: number;
  currency: CurrencyCode;
  counterpartyName: string;
  counterpartyDetail: string;
  category: string;
  referenceCode: string;
  memo: string;
  status: TxStatus;
  paymentRequestId?: string;
  peerTransferId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PaymentRequest {
  id: string;
  userId: string;
  accountId: string;
  title: string;
  payerName: string;
  payerEmail: string;
  amountCents: number;
  currency: CurrencyCode;
  memo: string;
  referenceCode: string;
  status: PaymentRequestStatus;
  paidAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  bankName: string;
  routingNumber: string;
  accountLast4: string;
  accountType: BeneficiaryAccountType;
  email: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface VirtualCard {
  id: string;
  userId: string;
  accountId: string;
  label: string;
  holderName: string;
  last4: string;
  expiry: string;
  network: CardNetwork;
  monthlyLimitCents: number;
  spentThisMonthCents: number;
  status: CardStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ScheduledPayment {
  id: string;
  userId: string;
  accountId: string;
  payeeName: string;
  category: string;
  amountCents: number;
  currency: CurrencyCode;
  cadence: ScheduledCadence;
  nextDueDate: string;
  status: ScheduledStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface RecipientDirectoryEntry {
  lookupKey: string;
  accountId: string;
  userId: string;
  displayName: string;
  handle: string;
  accountName: string;
  accountLast4: string;
  currency: CurrencyCode;
  status: AccountStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PeerTransfer {
  id: string;
  fromUserId: string;
  fromAccountId: string;
  toUserId: string;
  toAccountId: string;
  amountCents: number;
  currency: CurrencyCode;
  referenceCode: string;
  memo: string;
  createdAt: Timestamp | null;
}

export interface AdminRecord {
  uid: string;
  email: string;
  displayName: string;
  grantedBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}
