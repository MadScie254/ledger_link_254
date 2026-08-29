import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

export class CustomerService {
  static async getCustomers(orgId: string) {
    const db = getDb();
    const customersRef = collection(db, 'organizations', orgId, 'customers');
    const q = query(customersRef, orderBy('displayName'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createCustomer(orgId: string, input: any) {
    const db = getDb();
    const customersRef = collection(db, 'organizations', orgId, 'customers');
    const newDocRef = doc(customersRef);
    await setDoc(newDocRef, {
      displayName: input.displayName,
      legalName: input.legalName || input.displayName,
      customerType: input.customerType || 'Corporate',
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
      kraPin: input.kraPin || null,
      paymentTerms: input.paymentTerms || 'Net 30',
      creditLimitCents: input.creditLimitCents || 0,
      currency: input.currency || 'KES',
      discountPercent: input.discountPercent || 0,
      priceTier: input.priceTier || 'Standard',
      billingAddress: input.billingAddress || null,
      shippingAddress: input.shippingAddress || null,
      city: input.city || null,
      postalCode: input.postalCode || null,
      country: input.country || 'Kenya',
      notes: input.notes || null,
      balance: 0,
      createdAt: serverTimestamp()
    });
    return newDocRef.id;
  }
}
