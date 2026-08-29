import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

export class ProjectService {
  static async getProjects(orgId: string) {
    const db = getDb();
    const projectsRef = collection(db, 'organizations', orgId, 'projects');
    const q = query(projectsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createProject(orgId: string, input: any) {
    const db = getDb();
    const projectsRef = collection(db, 'organizations', orgId, 'projects');
    const newDocRef = doc(projectsRef);
    await setDoc(newDocRef, {
      name: input.name,
      clientName: input.clientName || null,
      budgetCents: input.budgetCents || 0,
      status: 'ACTIVE',
      createdAt: serverTimestamp()
    });
    return newDocRef.id;
  }
}
