import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBGPKWfZA6Zck1zJaT3JAhOa1iUVIPjwZo",
  authDomain: "paydos-crm.firebaseapp.com",
  projectId: "paydos-crm",
  storageBucket: "paydos-crm.firebasestorage.app",
  messagingSenderId: "1085867941071",
  appId: "1:1085867941071:web:f0b93edb5efed7de70abba",
  measurementId: "G-PWZXVZHDGN"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, 'paydos');
export const auth = getAuth(app);
export default app;
