import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBGPKWf2A6Zck1zJaT3JAhOai1UVIPjwZo",
  authDomain: "paydos-crm.firebaseapp.com",
  projectId: "paydos-crm",
  storageBucket: "paydos-crm.firebasestorage.app",
  messagingSenderId: "1085867941071",
  appId: "1:1085867941071:web:f0b93edb5efed7de70abba",
  measurementId: "G-PWZXVZHDGN"
};

const app = initializeApp(firebaseConfig);

// ÖNEMLİ: named database 'paydos' — değiştirme!
export const db = getFirestore(app, 'paydos');
export const auth = getAuth(app);

export default app;
