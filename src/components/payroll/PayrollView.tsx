import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';

const tabs = ['Employees', 'Run payroll', 'Payslips', 'Statutory filings (PAYE/NSSF/SHIF)'];

export function PayrollView() {
  const [activeTab, setActiveTab] = useState('Employees');
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch employees');
      return res.json();
    }
  });

  const employees = employeesData?.employees || [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Payroll & HR</h1>
        {activeTab === 'Employees' && (
          <button 
            onClick={() => setIsAddingEmployee(true)}
            className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Add Employee
          </button>
        )}
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab 
                ? 'border-brass-500 text-ink-900' 
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Employees' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">KRA PIN</th>
                <th className="px-4 py-3 font-semibold text-right">Base Salary (KES)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading employees...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No employees found.</td></tr>
              ) : (
                employees.map((emp: any) => (
                  <tr 
                    key={emp.id} 
                    onClick={() => setSelectedEmployee(emp)}
                    className="hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">{emp.firstName} {emp.lastName}</td>
                    <td className="px-4 py-3 text-slate-500">{emp.email || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{emp.kraPin || '-'}</td>
                    <td className="px-4 py-3 tabular-currency text-right text-ink-900 font-medium">
                      {formatCurrency(emp.baseSalaryCents)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-ledger-green-700/10 text-ledger-green-700">
                        {emp.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Run payroll' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8">
          <div className="flex items-center justify-between border-b border-ink-900/10 pb-6 mb-6">
            <div>
              <h3 className="text-lg font-medium text-ink-900">Next Pay Run</h3>
              <p className="text-sm text-slate-500">Period: Current Month</p>
            </div>
            <button className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
              Process Payroll &rarr;
            </button>
          </div>
          
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold text-right">Gross Pay</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">PAYE (Est)</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">NSSF/SHIF</th>
                <th className="px-4 py-3 font-semibold text-right">Net Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {employees.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Add employees to run payroll.</td></tr>
              ) : (
                employees.map((emp: any) => {
                  const gross = emp.baseSalaryCents / 100;
                  // Rough estimation for UI layout purposes
                  const paye = gross > 24000 ? gross * 0.15 : 0; 
                  const deductions = gross * 0.05;
                  const net = gross - paye - deductions;
                  
                  return (
                    <tr key={emp.id} className="hover:bg-paper-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-900">{emp.firstName} {emp.lastName}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">{formatCurrencyFromFloat(gross)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(paye)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(deductions)}</td>
                      <td className="px-4 py-3 tabular-currency text-right font-semibold text-ledger-green-700">{formatCurrencyFromFloat(net)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Payslips' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Employee Payslips</h3>
           <p className="text-slate-500 mb-6">View, download, and email generated payslips from past pay runs.</p>
           <div className="p-4 bg-paper-50 border border-ink-900/10 rounded-sm">
             <p className="text-sm text-slate-600">Run a payroll cycle first to generate payslips.</p>
           </div>
        </div>
      )}
      
      {activeTab === 'Statutory filings (PAYE/NSSF/SHIF)' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="text-center mb-6">
             <h3 className="text-xl font-medium text-ink-900 mb-2">Statutory Deductions Center</h3>
             <p className="text-slate-500">Auto-generated filing templates based on your processed payrolls.</p>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">PAYE</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">Kenya Revenue Authority</p>
               <button className="text-sm font-medium text-focus-blue-500 w-full text-left">Download P10</button>
             </div>
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">NSSF</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">National Social Security</p>
               <button className="text-sm font-medium text-focus-blue-500 w-full text-left">Export Excel Format</button>
             </div>
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">SHIF / NHIF</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">Social Health Authority</p>
               <button className="text-sm font-medium text-focus-blue-500 w-full text-left">Export Excel Format</button>
             </div>
           </div>
        </div>
      )}

      {/* Dynamic Contextual Add Employee Modal */}
      <DynamicQuickAddModal
        isOpen={isAddingEmployee}
        onClose={() => setIsAddingEmployee(false)}
        overrideType="EMPLOYEE"
      />

      {/* Comprehensive Employee Drill-Down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedEmployee}
        onClose={() => setSelectedEmployee(null)}
        entityType="EMPLOYEE"
        entityId={selectedEmployee?.id || null}
        initialData={selectedEmployee}
      />
    </div>
  );
}
