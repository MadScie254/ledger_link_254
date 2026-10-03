import assert from 'node:assert/strict';
import test from 'node:test';
import { changedFields, formValuesFor } from './recordForm.ts';

test('a supplier from the API fills the form, billing address as the address', () => {
  const values = formValuesFor('VENDOR', {
    displayName: 'Nairobi Steel', billingAddress: 'Enterprise Road', bankAccountNo: '0110', currency: null, kraPin: null,
  });
  assert.equal(values.displayName, 'Nairobi Steel');
  assert.equal(values.address, 'Enterprise Road');
  assert.equal(values.bankAccountNo, '0110');
  assert.equal(values.currency, 'KES');
  assert.equal(values.kraPin, '');
});

test('stock item prices and employee pay are shown in shillings', () => {
  const item = formValuesFor('ITEM', { name: 'Cement', type: 'Physical Product', unitPriceCents: 85_000, costPriceCents: 72_050, quantityOnHand: 340 });
  assert.equal(item.price, '850.00');
  assert.equal(item.cost, '720.50');
  assert.equal(item.quantityOnHand, '340');
  const employee = formValuesFor('EMPLOYEE', { firstName: 'Wanjiru', baseSalaryCents: 8_500_000, nhifNumber: 'SHA1', bankAccount: '99', hireDate: '2024-02-01T00:00:00Z' });
  assert.equal(employee.baseSalary, '85000.00');
  assert.equal(employee.shifNumber, 'SHA1');
  assert.equal(employee.bankAccountNo, '99');
  assert.equal(employee.hireDate, '2024-02-01');
});

test('only changed fields are sent, and an emptied field is cleared', () => {
  const before = { displayName: 'Acme', phone: '0700', email: 'a@b.example', creditLimitCents: 0 };
  const after = { displayName: 'Acme Ltd', phone: '', email: 'a@b.example', creditLimitCents: 0 };
  assert.deepEqual(changedFields(before, after), { displayName: 'Acme Ltd', phone: null });
  assert.deepEqual(changedFields(before, { ...before }), {});
});
