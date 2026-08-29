import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';

export interface AuditLogInput {
  orgId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  resourceType: 'ACCOUNT' | 'JOURNAL_ENTRY' | 'BANK_TRANSACTION' | 'BILL' | 'INVOICE' | 'USER_ROLE';
  resourceId: string;
  details: any;
}

export class AuditService {
  static async logEvent(input: AuditLogInput) {
    const db = getDb();
    const logsRef = collection(db, 'organizations', input.orgId, 'audit_logs');
    const newDocRef = doc(logsRef);
    
    await setDoc(newDocRef, {
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      details: input.details,
      timestamp: serverTimestamp()
    });
  }

  static async getLogs(orgId: string, maxResults = 50) {
    const db = getDb();
    const logsRef = collection(db, 'organizations', orgId, 'audit_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(maxResults));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}
