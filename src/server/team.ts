import { getDb } from './db';
import { collection, doc, setDoc, getDocs, query, serverTimestamp } from 'firebase/firestore';

export interface TeamMemberInput {
  orgId: string;
  name: string;
  email: string;
  role: 'Admin' | 'Editor' | 'Viewer';
  department: string;
}

export class TeamService {
  static async addMember(input: TeamMemberInput) {
    const db = getDb();
    const teamRef = collection(db, 'organizations', input.orgId, 'team_members');
    const newDocRef = doc(teamRef);
    
    await setDoc(newDocRef, {
      name: input.name,
      email: input.email,
      role: input.role,
      department: input.department,
      status: 'Active',
      joinedAt: serverTimestamp()
    });
    return newDocRef.id;
  }

  static async getMembers(orgId: string) {
    const db = getDb();
    const teamRef = collection(db, 'organizations', orgId, 'team_members');
    const snapshot = await getDocs(query(teamRef));
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}
