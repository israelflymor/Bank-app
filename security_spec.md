# Security Specification — Kestrel Bank

## 1. Data Invariants
1. **Strict Ownership, Admin Role & PII Isolation**: Every `/users/{userId}` document and financial resource (`/accounts`, `/transactions`, `/paymentRequests`, `/beneficiaries`, `/cards`, `/scheduledPayments`) is strictly readable and writable only by the authenticated owner (`request.auth.uid == userId` via verified Google Auth or credential-backed member `password` auth) or an authorized platform admin (`isAdmin()`). Admin privileges strictly require `request.auth.token.email_verified == true` alongside either the primary admin email (`stetons69@gmail.com`) or an active `/admins/{uid}` document created exclusively by an existing admin.
2. **PII-Safe Recipient Directory**: `/recipientDirectory/{lookupKey}` stores only non-PII transfer metadata keyed by handle, account number, or SHA-256 email hash. List queries are forbidden to non-admins; only exact `get` lookups are permitted to authenticated members.
3. **Atomic Peer-to-Peer Conservation of Funds**: Cross-user account credits on `/accounts/{accountId}` are strictly prohibited unless accompanied in the same atomic transaction by a `/peerTransfers/{transferId}` proof document verifying that the sender (`fromUserId == request.auth.uid`) simultaneously debited their own active same-currency account by the exact `amountCents > 0`.
4. **Immutable Financial Ledger & Identity Fields**: `userId`, `id`, `createdAt`, `accountNumber`, `routingNumber`, `iban`, and `currency` are immutable after creation (except one-time hash-verified claiming of a pre-seeded account). Settled or cancelled transactions and paid or cancelled payment requests are terminal-locked against non-admin updates.
5. **Temporal Integrity & Exact Integer Cents**: All `createdAt` and `updatedAt` fields must equal `request.time` on create/update; monetary amounts are strictly validated as integers within blueprint bounds.
6. **Default-Frozen Withdrawal Access & Admin-Only Unfreeze**: All new user profiles must initialize with `withdrawalFrozen: true`, and missing `withdrawalFrozen` fields fail closed as frozen. Only verified admins (`isAdmin()`) may update `withdrawalFrozen`. While frozen, external transfers (`transfer_out`), peer transfers (`p2p_transfer` debits and `/peerTransfers`), bill payments (`bill_pay`), card spending (`card_spend` and `cards.spentThisMonthCents`), and non-admin settlement of pending blocked-type debits are denied, while internal account sweeps (`internal_transfer`) and inbound credits remain allowed.
7. **Hash-Verified Seeded Member Claiming**: `/memberCredentials/{accountNumber}` stores no PII and cannot be read or listed by non-owners. Pre-seeded accounts with `claimedUid == ''` can only be claimed once by presenting the exact SHA-256 `routingHash` proof in the update payload.

## 2. The "Dirty Dozen" (20) Adversarial Payloads
1. **Unauthenticated Write**: Creating `/accounts/acc_1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Admin Spoof**: Calling admin read/write with `email: 'stetons69@gmail.com'` and `email_verified: false` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Account Theft (Get)**: Non-admin User B reading `/accounts/acc_userA` -> `PERMISSION_DENIED`.
4. **Blanket List Query Scraping**: Non-admin User B executing `list` on `/transactions`, `/recipientDirectory`, or `/memberCredentials` -> `PERMISSION_DENIED`.
5. **Self-Assigned Admin Escalation**: Non-admin User B creating `/admins/{userB}` -> `PERMISSION_DENIED`.
6. **Identity Spoofing on Create**: User A creating `/transactions/tx_1` with `userId: "user_B"` without valid peer transfer proof -> `PERMISSION_DENIED`.
7. **Orphaned Account Reference**: User A creating `/transactions/tx_1` with `accountId: "nonexistent_account"` -> `PERMISSION_DENIED`.
8. **Shadow / Ghost Field Injection**: User A creating `/beneficiaries/ben_1` with an extra field `isAdmin: true` -> `PERMISSION_DENIED`.
9. **ID Poisoning**: Creating `/accounts/` + 129-char ID or invalid characters -> `PERMISSION_DENIED`.
10. **Negative / Non-Integer Amount Poisoning**: Creating `/transactions/tx_1` with `amountCents: -5000` or `12.34` -> `PERMISSION_DENIED`.
11. **Unfunded Peer Credit Forgery**: User A incrementing User B's `accounts/{accB}.balanceCents` without a matching sender debit and `/peerTransfers` record -> `PERMISSION_DENIED`.
12. **Peer Debit Attack**: User A attempting to decrease User B's `accounts/{accB}.balanceCents` -> `PERMISSION_DENIED`.
13. **Terminal State Mutation**: Non-admin User A updating a `transactions` document whose existing `status == 'settled'` -> `PERMISSION_DENIED`.
14. **Paid Request Re-Opening**: Non-admin User A updating a `paymentRequests` document whose existing `status == 'paid'` back to `'pending'` -> `PERMISSION_DENIED`.
15. **Client Timestamp Forgery**: Creating `/accounts/acc_1` with a backdated `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
16. **Self-Unfreeze & Frozen Outflow Bypass**: Non-admin User A creating `/users/{userA}` with `withdrawalFrozen: false`, updating their own `withdrawalFrozen` to `false`, or creating a `transfer_out` / `p2p_transfer` / `bill_pay` / `card_spend` transaction while `withdrawalFrozen != false` -> `PERMISSION_DENIED`.
17. **Frozen User Settling Pending Debit**: Non-admin frozen User A updating a `pending` `transfer_out` debit transaction to `settled` -> `PERMISSION_DENIED`.
18. **Unclaimed Seeded Credential Theft Without Proof**: Non-admin attacker updating `/memberCredentials/0036028172` with wrong `routingHash` -> `PERMISSION_DENIED`.
19. **Seeded Credential Enumeration**: Non-admin user reading `/memberCredentials/0036028172` before claiming -> `PERMISSION_DENIED`.
20. **Re-Claiming Already Claimed Account**: Attacker overwriting `claimedUid` when `existing().claimedUid != ''` -> `PERMISSION_DENIED`.
