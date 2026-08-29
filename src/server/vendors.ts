import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

export class VendorService {
  static async getVendors(orgId: string) {
    const db = getDb();
    const vendorsRef = collection(db, 'organizations', orgId, 'vendors');
    const q = query(vendorsRef, orderBy('displayName'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createVendor(orgId: string, input: any) {
    const db = getDb();
    const vendorsRef = collection(db, 'organizations', orgId, 'vendors');
    const newDocRef = doc(vendorsRef);
    await setDoc(newDocRef, {
      displayName: input.displayName,
      legalName: input.legalName || input.displayName,
      vendorType: input.vendorType || 'Supplier',
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
      kraPin: input.kraPin || null,
      vatNumber: input.vatNumber || null,
      category: input.category || 'General Supplies',
      paymentTerms: input.paymentTerms || 'Net 30',
      currency: input.currency || 'KES',
      defaultAccountId: input.defaultAccountId || null,
      paymentMethod: input.paymentMethod || 'Bank Transfer',
      bankName: input.bankName || null,
      bankAccountNo: input.bankAccountNo || null,
      bankBranch: input.bankBranch || null,
      mpesaNumber: input.mpesaNumber || null,
      address: input.address || null,
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
