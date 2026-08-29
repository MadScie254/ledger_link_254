import { getDb } from './db';
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { AuditService } from './audit';

export interface AccountInput {
  orgId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
  subtype?: string;
  parentId?: string;
  createdBy?: string;
}

export class AccountService {
  static async createAccount(input: AccountInput): Promise<string> {
    const db = getDb();
    
    // Check if code already exists for this org
    const accountsRef = collection(db, 'organizations', input.orgId, 'accounts');
    const q = query(accountsRef, where('code', '==', input.code));
    const existing = await getDocs(q);
      
    if (!existing.empty) {
      throw new Error(`Account code ${input.code} already exists.`);
    }

    const newDocRef = doc(accountsRef);
    
    await setDoc(newDocRef, {
      code: input.code,
      name: input.name,
      type: input.type,
      subtype: input.subtype || null,
      parentId: input.parentId || null,
      isActive: true,
      createdAt: new Date().toISOString()
    });

    if (input.createdBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.createdBy,
        action: 'CREATE',
        resourceType: 'ACCOUNT',
        resourceId: newDocRef.id,
        details: { code: input.code, name: input.name, type: input.type }
      });
    }

    return newDocRef.id;
  }

  static async getAccountByCode(orgId: string, code: string) {
    const db = getDb();
    const accountsRef = collection(db, 'organizations', orgId, 'accounts');
    const q = query(accountsRef, where('code', '==', code), limit(1));
    const snapshot = await getDocs(q);
      
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  }

  static async bulkCreateAccounts(orgId: string, accounts: Omit<AccountInput, 'orgId'>[], userId?: string): Promise<{ success: number, failed: number, accountIds: string[] }> {
    let success = 0;
    let failed = 0;
    const accountIds: string[] = [];
    for (const acc of accounts) {
      try {
        const id = await this.createAccount({ ...acc, orgId, createdBy: userId });
        accountIds.push(id);
        success++;
      } catch (err) {
        failed++;
      }
    }
    return { success, failed, accountIds };
  }
  
  static async bulkDeleteAccounts(orgId: string, accountIds: string[], userId?: string) {
    const db = getDb();
    const accountsRef = collection(db, 'organizations', orgId, 'accounts');
    for (const id of accountIds) {
      await deleteDoc(doc(accountsRef, id));
      if (userId) {
        await AuditService.logEvent({
          orgId,
          userId,
          action: 'DELETE',
          resourceType: 'ACCOUNT',
          resourceId: id,
          details: { message: 'Undo bulk operation' }
        });
      }
    }
  }

  static async getAccounts(orgId: string) {
    const db = getDb();
    const accountsRef = collection(db, 'organizations', orgId, 'accounts');
    const q = query(accountsRef, orderBy('code'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}
