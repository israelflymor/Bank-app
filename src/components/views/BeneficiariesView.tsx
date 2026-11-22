import React, { useState } from 'react';
import { ArrowUpRight, Plus, Trash2, Users } from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  type Beneficiary,
  type BeneficiaryAccountType,
} from '../../types/banking';
import { createBeneficiary, deleteBeneficiary } from '../../services/bankingService';
import { Modal } from '../ui/Modal';

interface BeneficiariesViewProps {
  userId: string;
  beneficiaries: Beneficiary[];
  onSendToBeneficiary: (beneficiaryId: string) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const BeneficiariesView: React.FC<BeneficiariesViewProps> = ({
  userId,
  beneficiaries,
  onSendToBeneficiary,
  onNotify,
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<BeneficiaryAccountType>('checking');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || bankName.trim().length < 2) {
      onNotify('error', 'Enter a valid recipient and bank name.');
      return;
    }
    if (!BLUEPRINT_LIMITS.ROUTING_REGEX.test(routingNumber.trim())) {
      onNotify('error', 'Routing number must be exactly 9 digits.');
      return;
    }
    if (!BLUEPRINT_LIMITS.LAST4_REGEX.test(accountLast4.trim())) {
      onNotify('error', 'Account suffix must be exactly 4 digits.');
      return;
    }

    setSaving(true);
    try {
      await createBeneficiary({
        userId,
        name: name.trim(),
        bankName: bankName.trim(),
        routingNumber: routingNumber.trim(),
        accountLast4: accountLast4.trim(),
        accountType,
        email: email.trim(),
      });
      setName('');
      setBankName('');
      setRoutingNumber('');
      setAccountLast4('');
      setEmail('');
      setAddOpen(false);
      onNotify('success', `Saved beneficiary ${name.trim()}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save beneficiary.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ben: Beneficiary) => {
    setDeletingId(ben.id);
    try {
      await deleteBeneficiary(ben.id);
      onNotify('success', `Removed ${ben.name} from beneficiaries.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to remove beneficiary.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Saved Beneficiaries</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Verified external counterparties for rapid ACH and Fedwire transfers
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Beneficiary</span>
        </button>
      </div>

      {beneficiaries.length === 0 ? (
        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-12 text-center">
          <Users className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-900 mb-1">No beneficiaries saved</p>
          <p className="text-xs text-slate-500 mb-4">
            Store trusted vendor or personal bank details for one-click payouts.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-[#0B162C] hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            Add First Beneficiary
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                  <th className="py-2.5 px-6">Recipient</th>
                  <th className="py-2.5 px-4">Institution</th>
                  <th className="py-2.5 px-4">Routing &amp; Account</th>
                  <th className="py-2.5 px-4">Rail</th>
                  <th className="py-2.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {beneficiaries.map((ben) => (
                  <tr key={ben.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-6">
                      <p className="font-medium text-slate-900">{ben.name}</p>
                      <p className="text-xs text-slate-500">{ben.email || 'No remittance email'}</p>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">{ben.bankName}</td>
                    <td className="py-3.5 px-4 text-xs font-mono tabular-nums text-slate-600">
                      RTN {ben.routingNumber} · •••• {ben.accountLast4}
                    </td>
                    <td className="py-3.5 px-4 text-xs capitalize text-slate-700">
                      {ben.accountType}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSendToBeneficiary(ben.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          <span>Send Money</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ben)}
                          disabled={deletingId === ben.id}
                          aria-label={`Remove ${ben.name}`}
                          className="p-1.5 text-slate-400 hover:text-red-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Beneficiary"
        subtitle="Save an external bank recipient for ACH or wire transfers"
      >
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label htmlFor="ben-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Recipient / Company Name
            </label>
            <input
              id="ben-name"
              type="text"
              required
              maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pacific Legal LLP"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ben-bank" className="block text-xs font-medium text-slate-700 mb-1.5">
                Bank Name
              </label>
              <input
                id="ben-bank"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.PARTY_MAX}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. JPMorgan Chase"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="ben-type" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account / Rail Type
              </label>
              <select
                id="ben-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as BeneficiaryAccountType)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="checking">Checking (ACH)</option>
                <option value="savings">Savings (ACH)</option>
                <option value="wire">Fedwire</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ben-rtn" className="block text-xs font-medium text-slate-700 mb-1.5">
                ABA Routing (9 digits)
              </label>
              <input
                id="ben-rtn"
                type="text"
                required
                maxLength={9}
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="021000021"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label htmlFor="ben-last4" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account Last 4 Digits
              </label>
              <input
                id="ben-last4"
                type="text"
                required
                maxLength={4}
                value={accountLast4}
                onChange={(e) => setAccountLast4(e.target.value.replace(/\D/g, ''))}
                placeholder="8814"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ben-email" className="block text-xs font-medium text-slate-700 mb-1.5">
              Remittance Email (optional)
            </label>
            <input
              id="ben-email"
              type="email"
              maxLength={BLUEPRINT_LIMITS.EMAIL_MAX}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ap@vendor.com"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Beneficiary'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
