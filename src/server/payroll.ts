import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

export class PayrollService {
  static async getEmployees(orgId: string) {
    const db = getDb();
    const employeesRef = collection(db, 'organizations', orgId, 'employees');
    const q = query(employeesRef, orderBy('lastName'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async addEmployee(orgId: string, input: any) {
    const db = getDb();
    const employeesRef = collection(db, 'organizations', orgId, 'employees');
    const newDocRef = doc(employeesRef);
    await setDoc(newDocRef, {
      firstName: input.firstName,
      middleName: input.middleName || null,
      lastName: input.lastName,
      nationalId: input.nationalId || null,
      email: input.email || null,
      phone: input.phone || null,
      jobTitle: input.jobTitle || 'Staff',
      department: input.department || 'Operations',
      employmentType: input.employmentType || 'Full-time',
      hireDate: input.hireDate || new Date().toISOString().substring(0, 10),
      kraPin: input.kraPin || null,
      nssfNumber: input.nssfNumber || null,
      shifNumber: input.shifNumber || null,
      baseSalaryCents: input.baseSalaryCents || 0,
      housingAllowanceCents: input.housingAllowanceCents || 0,
      transportAllowanceCents: input.transportAllowanceCents || 0,
      bankName: input.bankName || null,
      bankAccountNo: input.bankAccountNo || null,
      mpesaNumber: input.mpesaNumber || null,
      status: 'ACTIVE',
      createdAt: serverTimestamp()
    });
    return newDocRef.id;
  }
}
