import React from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useState } from 'react';
import { Clock, Plus, Mail } from 'lucide-react';
import { format } from 'date-fns';

export function RecurringInvoices() {
  const [schedules, setSchedules] = useState([
    {
      id: '1',
      customerName: 'Acme Corp',
      frequency: 'Monthly',
      nextIssueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
      amountCents: 1500000,
      autoEmail: true,
      active: true
    }
  ]);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    setSchedules([
      ...schedules,
      {
        id: Math.random().toString(),
        customerName: fd.get('customerName') as string,
        frequency: fd.get('frequency') as string,
        nextIssueDate: fd.get('startDate') as string,
        amountCents: parseFloat(fd.get('amount') as string) * 100,
        autoEmail: fd.get('autoEmail') === 'on',
        active: true
      }
    ]);
    setIsCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-ink-900 flex items-center">
            <Clock className="h-5 w-5 mr-2 text-focus-blue-500" />
            Recurring Profiles
          </h2>
          <p className="text-sm text-slate-500 mt-1">Automate invoice generation and email delivery for repeat clients.</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors flex items-center"
        >
          <Plus className="h-4 w-4 mr-1" /> New Schedule
        </button>
      </div>

      <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
        {schedules.length === 0 ? (
          <div className="p-16 text-center text-slate-500">
            <p>No recurring profiles configured.</p>
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Frequency</th>
                <th className="px-4 py-3 font-semibold">Next Issue</th>
                <th className="px-4 py-3 font-semibold">Delivery</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-ink-900">{schedule.customerName}</td>
                  <td className="px-4 py-3 text-slate-600">{schedule.frequency}</td>
                  <td className="px-4 py-3 tabular-currency text-slate-600">
                    {format(new Date(schedule.nextIssueDate), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    {schedule.autoEmail ? (
                      <span className="inline-flex items-center text-xs font-medium text-slate-600">
                        <Mail className="h-3 w-3 mr-1" /> Auto-email
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Manual draft</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${schedule.active ? 'bg-ledger-green-700/10 text-ledger-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {schedule.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-currency text-right text-ink-900 font-medium">
                    {formatCurrency(schedule.amountCents )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isCreating && (
        <div className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-lg shadow-xl w-full max-w-lg border border-ink-900/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-ink-900/10">
              <h3 className="text-lg font-medium text-ink-900">New Recurring Schedule</h3>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">Customer Name</label>
                <input required name="customerName" type="text" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" placeholder="e.g. Acme Corp" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-900 mb-1">Frequency</label>
                  <select required name="frequency" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none">
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-900 mb-1">Start Date</label>
                  <input required name="startDate" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">Base Amount (KES)</label>
                <input required name="amount" type="number" step="0.01" placeholder="0.00" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency" />
              </div>
              <div className="pt-2">
                <label className="flex items-center space-x-2 text-sm text-ink-900 cursor-pointer">
                  <input type="checkbox" name="autoEmail" defaultChecked className="rounded border-ink-900/20 text-focus-blue-500 focus:ring-focus-blue-500" />
                  <span>Automatically email invoice on generation</span>
                </label>
                <p className="text-xs text-slate-500 ml-6 mt-1">If unchecked, invoices will be saved as drafts for review.</p>
              </div>
              <div className="flex justify-end space-x-3 pt-6">
                <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>
                <button type="submit" className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
                  Create Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
