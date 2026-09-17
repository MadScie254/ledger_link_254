import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { Dialog, Field } from '../ledger/Dialog';
import { PageHeading, IndexTabs, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';

type Tab = 'Projects' | 'Hours';

export function ProjectsView() {
  const [activeTab, setActiveTab] = useState<Tab>('Projects');
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [timesheetProjectId, setTimesheetProjectId] = useState('');
  const [timesheetDate, setTimesheetDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [timesheetHours, setTimesheetHours] = useState('');
  const [timesheetNotes, setTimesheetNotes] = useState('');
  const [timesheetError, setTimesheetError] = useState('');

  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ['projects', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/projects', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },
  });

  const customersQuery = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
  });

  const timeQuery = useQuery({
    queryKey: ['time-entries', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/time-entries', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch time entries');
      return res.json();
    },
    enabled: activeTab === 'Hours',
  });

  const submitTimesheetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          projectId: timesheetProjectId,
          entryDate: timesheetDate,
          hours: parseFloat(timesheetHours || '0'),
          description: timesheetNotes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The hours could not be saved.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', currentOrgId] });
      setTimesheetHours('');
      setTimesheetNotes('');
      setTimesheetError('');
    },
    onError: (err: any) => setTimesheetError(err.message),
  });

  const addProjectMutation = useMutation({
    mutationFn: async (project: any) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify(project),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The project could not be saved.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', currentOrgId] });
      setIsAddingProject(false);
      setProjectError('');
    },
    onError: (err: any) => setProjectError(err.message),
  });

  const projects: any[] = projectsQuery.data?.projects || [];
  const customers: any[] = customersQuery.data?.customers || [];
  const customerName = (id?: string) => customers.find((c) => c.id === id)?.displayName;
  const entries: any[] = timeQuery.data?.entries || [];
  const totalBudget = projects.reduce((s, p) => s + (p.budgetCents || 0), 0);
  const totalCost = projects.reduce((s, p) => s + (p.costCents || 0), 0);
  const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0);

  const used = (p: any) => {
    const budget = p.budgetCents || 0;
    const cost = p.costCents || 0;
    if (!budget) return <span className="text-[12px] text-graphite-600">No budget</span>;
    const pct = Math.round((cost / budget) * 100);
    return cost > budget ? (
      <Mark kind="circled" label={`${pct}% · over budget`} />
    ) : (
      <span className="ll-figure text-ink-900">{pct}%</span>
    );
  };

  const closeProjectDialog = () => {
    setIsAddingProject(false);
    setProjectError('');
  };

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        title="Projects"
        note={<>Budget against cost posted to each job, and the hours logged to it · Figures in {baseCurrency}</>}
        actions={
          <button type="button" onClick={() => setIsAddingProject(true)} className={buttonClass.primary}>
            Open a project
          </button>
        }
      />

      <IndexTabs
        label="Projects"
        active={activeTab}
        onChange={(id) => setActiveTab(id as Tab)}
        tabs={[
          { id: 'Projects', name: 'Budget and cost', count: projects.length },
          { id: 'Hours', name: 'Hours logged' },
        ]}
      />

      {activeTab === 'Projects' &&
        (projectsQuery.isError ? (
          <LoadProblem what="projects" path="/api/projects" onRetry={() => projectsQuery.refetch()} />
        ) : projectsQuery.isLoading ? (
          <SkeletonRows label="Loading projects" />
        ) : projects.length === 0 ? (
          <EmptyNote
            action={
              <button type="button" onClick={() => setIsAddingProject(true)} className={buttonClass.quiet}>
                Open the first project
              </button>
            }
          >
            No projects yet. Each job is listed with its budget, the cost posted against it and how much of the budget is used.
          </EmptyNote>
        ) : (
          <>
            <ul className="sm:hidden" aria-label={`Projects, figures in ${baseCurrency}`}>
              {projects.map((p) => (
                <li key={p.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14.5px] text-ink-900">{p.name}</span>
                    {used(p)}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3 text-[12.5px] text-graphite-600">
                    <span className="truncate">{customerName(p.customerId) || 'Internal'} · {p.status}</span>
                    <span className="shrink-0">
                      <Amount cents={p.costCents || 0} currency={baseCurrency} size="xs" tone="ink" /> of <Amount cents={p.budgetCents || 0} currency={baseCurrency} size="xs" tone="ink" />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[13.5px]">
                <caption className="sr-only">Projects, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Project</th>
                    <th scope="col" className="pr-4 text-left">Customer</th>
                    <th scope="col" className="pr-4 text-left">Status</th>
                    <th scope="col" className="pr-4 text-right">Budget</th>
                    <th scope="col" className="pr-4 text-right">Cost to date</th>
                    <th scope="col" className="text-right">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td className="pr-4 text-ink-900">
                        {p.projectCode && <span className="mr-2 whitespace-nowrap ll-figure font-semibold">{p.projectCode}</span>}
                        {p.name}
                      </td>
                      <td className="pr-4 text-graphite-600">{customerName(p.customerId) || 'Internal'}</td>
                      <td className="pr-4 text-graphite-600">{p.status}</td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.budgetCents || 0} currency={baseCurrency} tone="ink" /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.costCents || 0} currency={baseCurrency} tone="ink" /></td>
                      <td className="text-right whitespace-nowrap">{used(p)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                      All projects
                    </th>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={totalBudget} currency={baseCurrency} tone="ink" /></td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={totalCost} currency={baseCurrency} tone="ink" /></td>
                    <td className="ll-total py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ))}

      {activeTab === 'Hours' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTimesheetError('');
              submitTimesheetMutation.mutate();
            }}
            className="ll-margin grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]"
            aria-label="Log hours"
          >
            <Field label="Project">
              <select required value={timesheetProjectId} onChange={(e) => setTimesheetProjectId(e.target.value)}>
                <option value="">Choose a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input required type="date" value={timesheetDate} onChange={(e) => setTimesheetDate(e.target.value)} />
            </Field>
            <Field label="Hours" hint="In quarter hours">
              <input required type="number" inputMode="decimal" min="0.25" max="24" step="0.25" value={timesheetHours} onChange={(e) => setTimesheetHours(e.target.value)} className="tabular-currency" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-2">
              <Field label="What was done" error={timesheetError || undefined}>
                <input type="text" value={timesheetNotes} onChange={(e) => setTimesheetNotes(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={submitTimesheetMutation.isPending} className={`${buttonClass.secondary} h-10 w-full`}>
                {submitTimesheetMutation.isPending ? 'Saving' : 'Log these hours'}
              </button>
            </div>
          </form>

          {timeQuery.isError ? (
            <LoadProblem what="hours logged" path="/api/time-entries" onRetry={() => timeQuery.refetch()} />
          ) : timeQuery.isLoading ? (
            <SkeletonRows label="Loading hours logged" />
          ) : entries.length === 0 ? (
            <EmptyNote>No hours logged yet. Each entry is listed here by date, with the project and what was done.</EmptyNote>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[30rem] text-[13.5px]">
                <caption className="sr-only">Hours logged, latest 100</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Date</th>
                    <th scope="col" className="pr-4 text-left">Project</th>
                    <th scope="col" className="pr-4 text-left">What was done</th>
                    <th scope="col" className="text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{format(new Date(entry.entryDate), 'dd/MM/yyyy')}</td>
                      <td className="pr-4 text-ink-900">{entry.projectName}</td>
                      <td className="pr-4 text-graphite-600">{entry.description || '–'}</td>
                      <td className="text-right ll-figure text-ink-900">{entry.hours.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Hours shown</th>
                    <td className="ll-total py-2 text-right ll-figure font-semibold text-ink-900">{totalHours.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={isAddingProject}
        onClose={closeProjectDialog}
        title="Open a project"
        note="Costs posted against it are tracked against the budget."
        footer={
          <>
            <button type="button" onClick={closeProjectDialog} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="project-form" disabled={addProjectMutation.isPending} className={buttonClass.primary}>
              {addProjectMutation.isPending ? 'Saving' : 'Open project'}
            </button>
          </>
        }
      >
        <form
          id="project-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            addProjectMutation.mutate({
              name: fd.get('name'),
              customerId: fd.get('customerId') || undefined,
              budgetCents: Math.round(parseFloat((fd.get('budget') as string) || '0') * 100),
            });
          }}
          className="space-y-4"
        >
          <Field label="Project name">
            <input required name="name" type="text" />
          </Field>
          <Field label="Customer" hint="Leave as internal for work not billed to a customer">
            <select name="customerId" defaultValue="">
              <option value="">Internal</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label={`Budget (${baseCurrency})`} error={projectError || undefined}>
            <input required name="budget" type="number" inputMode="decimal" step="0.01" min="0" className="tabular-currency" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
