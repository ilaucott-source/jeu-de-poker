import type { FirebaseOptions } from 'firebase/app';

/**
 * Réglages du projet Firebase (synchronisation entre appareils).
 * Ces valeurs ne sont pas secrètes : elles identifient le projet, la sécurité vient des règles Firestore.
 * Tant que c'est null, la synchronisation est simplement masquée.
 */
const PROJECT: FirebaseOptions | null = null;

/** Pour les tests : VITE_FB_EMULATOR=1 branche les émulateurs Firebase locaux. */
export const USE_EMULATOR = import.meta.env.VITE_FB_EMULATOR === '1';
export const FIREBASE_CONFIG: FirebaseOptions | null = USE_EMULATOR ? { apiKey: 'demo', projectId: 'demo-poker', authDomain: 'demo-poker.firebaseapp.com', appId: 'demo' } : PROJECT;
