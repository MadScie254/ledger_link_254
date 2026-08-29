import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

export class InventoryService {
  static async getItems(orgId: string) {
    const db = getDb();
    const itemsRef = collection(db, 'organizations', orgId, 'inventory_items');
    const q = query(itemsRef, orderBy('name'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createItem(orgId: string, input: any) {
    const db = getDb();
    const itemsRef = collection(db, 'organizations', orgId, 'inventory_items');
    const newDocRef = doc(itemsRef);
    await setDoc(newDocRef, {
      name: input.name,
      itemType: input.itemType || 'Physical Product',
      sku: input.sku || null,
      barcode: input.barcode || null,
      category: input.category || 'General',
      unitOfMeasure: input.unitOfMeasure || 'Units',
      description: input.description || null,
      priceCents: input.priceCents || 0,
      costCents: input.costCents || 0,
      taxRate: input.taxRate !== undefined ? Number(input.taxRate) : 16,
      incomeAccountId: input.incomeAccountId || null,
      expenseAccountId: input.expenseAccountId || null,
      quantityOnHand: input.quantityOnHand || 0,
      reorderPoint: input.reorderPoint || 0,
      targetStock: input.targetStock || 0,
      preferredVendorId: input.preferredVendorId || null,
      location: input.location || null,
      notes: input.notes || null,
      createdAt: serverTimestamp()
    });
    return newDocRef.id;
  }
}
