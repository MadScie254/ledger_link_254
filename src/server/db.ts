import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {}

// Initialize Firebase if not already initialized
if (getApps().length === 0 && firebaseConfig) {
  initializeApp(firebaseConfig);
}

// Helper to get Firestore instance
export function getDb() {
  if (getApps().length === 0) {
    throw new Error('Firebase is not initialized.');
  }
  const app = getApp();
  return getFirestore(app, firebaseConfig?.firestoreDatabaseId);
}
