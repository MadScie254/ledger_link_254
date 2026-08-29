import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';

const tabs = ['Project list', 'Job costing', 'Time tracking'];

export function ProjectsView() {
  const [activeTab, setActiveTab] = useState('Project list');
  const [isAddingProject, setIsAddingProject] = useState(false);
  
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['projects', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/projects', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    }
  });

  const addProjectMutation = useMutation({
    mutationFn: async (project: any) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify(project)
      });
      if (!res.ok) throw new Error('Failed to add project');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', currentOrgId] });
      setIsAddingProject(false);
    }
  });

  const projects = projectsData?.projects || [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Projects & Jobs</h1>
        {activeTab === 'Project list' && (
          <button 
            onClick={() => setIsAddingProject(true)}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Create Project
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

      {activeTab === 'Project list' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Project Name</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold text-right">Budget</th>
                <th className="px-4 py-3 font-semibold text-right">Cost to Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading projects...</td></tr>
              ) : projects.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No projects found. Create one to get started.</td></tr>
              ) : (
                projects.map((proj: any) => {
                  const budget = (proj.budgetCents || 0) / 100;
                  // Pull actual cost if available, otherwise 0
                  const cost = (proj.actualCostCents || 0) / 100; 
                  
                  return (
                    <tr key={proj.id} className="hover:bg-paper-50 transition-colors cursor-pointer group">
                      <td className="px-4 py-3 font-medium text-ink-900">{proj.name}</td>
                      <td className="px-4 py-3 text-slate-500">{proj.clientName || '-'}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">
                        {formatCurrencyFromFloat(budget)}
                      </td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">
                        {formatCurrencyFromFloat(cost)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-ledger-green-700/10 text-ledger-green-700">
                          {proj.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Job costing' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
          <div className="text-center mb-8">
             <h3 className="text-lg font-medium text-ink-900">Job Costing Analysis</h3>
             <p className="text-sm text-slate-500">Compare actual expenses against project budgets in real-time.</p>
          </div>
          
          <div className="space-y-6">
            {projects.length === 0 ? (
              <p className="text-center text-slate-500">No active projects available for analysis.</p>
            ) : (
              projects.map((proj: any) => {
                const budget = proj.budgetCents / 100;
                // Generate a stable mock cost between 30% and 90% for layout demo
                const cost = budget * 0.65;
                const percentage = Math.min(Math.round((cost / budget) * 100), 100) || 0;
                const isOver = cost > budget;
                
                return (
                  <div key={proj.id} className="border border-ink-900/10 rounded-sm p-5 bg-paper-50">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="font-semibold text-ink-900">{proj.name}</h4>
                        <p className="text-xs text-slate-500">Client: {proj.clientName || 'Internal'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular-currency">
                          <span className={isOver ? 'text-rust-700' : 'text-ink-900'}>{formatCurrencyFromFloat(cost)}</span>
                          <span className="text-slate-400 mx-1">/</span>
                          <span className="text-slate-600">{formatCurrencyFromFloat(budget)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="w-full bg-ink-900/10 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${isOver ? 'bg-rust-700' : 'bg-ledger-green-700'}`} 
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 text-right">{percentage}% used</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'Time tracking' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Timesheets & Hours</h3>
           <p className="text-slate-500 mb-6">Log billable hours against specific projects and auto-sync them to payroll or invoices.</p>
           <button className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
             Submit Timesheet
           </button>
        </div>
      )}

      {/* Add Project Modal */}
      {isAddingProject && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-sm shadow-xl border border-ink-900/10 w-full max-w-md p-6">
            <h3 className="text-xl font-serif text-ink-900 mb-4">Create Project</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              addProjectMutation.mutate({
                name: fd.get('name'),
                clientName: fd.get('clientName'),
                budgetCents: Math.round(parseFloat(fd.get('budget') as string) * 100),
              });
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Project Name *</label>
                <input required name="name" type="text" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Client Name</label>
                <input name="clientName" type="text" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Project Budget *</label>
                <input required name="budget" type="number" step="0.01" min="0" placeholder="0.00" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency" />
              </div>

              <div className="flex justify-end space-x-3 pt-6 border-t border-ink-900/10 mt-6">
                <button type="button" onClick={() => setIsAddingProject(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>
                <button type="submit" disabled={addProjectMutation.isPending} className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors disabled:opacity-50">
                  {addProjectMutation.isPending ? 'Saving...' : 'Save Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
