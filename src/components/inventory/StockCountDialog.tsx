import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';

/**
 * Records a stock count: the quantity counted replaces the quantity on hand,
 * and the difference is kept as a movement with its reason. This is the only
 * way to change a count by hand.
 */
export function StockCountDialog({ item, orgId, onClose, onDone }: {
  item: { id: string; name: string; quantityOnHand: number; unitOfMeasure?: string } | null;
  orgId: string;
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);

  const save = useMutation({
    mutationFn: () => apiRequest<{ quantity: number; quantityOnHand: number }>(`/api/inventory/${item!.id}/adjustments`, {
      body: { countedQuantity: Number(counted), reason: reason.trim(), idempotencyKey: key },
      fallback: 'The count could not be recorded.',
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', orgId] });
      queryClient.invalidateQueries({ queryKey: ['drilldown-transactions', 'ITEM', item!.id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['drilldown', 'ITEM', item!.id, orgId] });
      const change = result.quantity === 0 ? 'no change' : `${result.quantity > 0 ? '+' : ''}${result.quantity}`;
      onDone?.(`${item!.name}: count recorded, ${result.quantityOnHand} on hand (${change}).`);
      onClose();
    },
  });

  useEffect(() => {
    if (!item) return;
    setCounted(String(item.quantityOnHand ?? 0));
    setReason('');
    setKey(newIdempotencyKey());
    save.reset();
  }, [item]);

  const countedNumber = Number(counted);
  const valid = counted.trim() !== '' && Number.isInteger(countedNumber) && countedNumber >= 0;
  const difference = valid && item ? countedNumber - (item.quantityOnHand ?? 0) : 0;
  const unit = item?.unitOfMeasure || 'units';

  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={item ? `Count ${item.name}` : 'Count stock'}
      note={item ? `${item.quantityOnHand ?? 0} ${unit} on hand in the books.` : undefined}
      footer={
        <>
          {save.isError && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{save.error.message}</p>}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" form="stock-count-form" disabled={!valid || !reason.trim() || save.isPending} className={buttonClass.primary}>
            {save.isPending ? 'Recording' : 'Record count'}
          </button>
        </>
      }
    >
      <form
        id="stock-count-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={`Quantity counted (${unit})`} hint={valid ? (difference === 0 ? 'Matches the books.' : `${difference > 0 ? '+' : ''}${difference} against the books.`) : 'A whole number, zero or more.'}>
          <input type="number" min="0" step="1" inputMode="numeric" required value={counted} onChange={(e) => setCounted(e.target.value)} className="tabular-currency" />
        </Field>
        <Field label="Reason" hint="For example, monthly count, damaged in storage, or found in the back store">
          <input type="text" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
