// ============================================================
// Promptly — Firebase + Cloudinary configuration
// ============================================================
// This file holds your project keys. Safe to commit publicly:
//   - Firebase keys are PUBLIC by design; security is enforced
//     server-side via Firestore/Storage RULES (already set up).
//   - Cloudinary "unsigned upload preset" is meant to be public.
// ============================================================

// ---------- Firebase ----------
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyABdE5syJoBUVgrY47nqblaMHhTSeLIeBU",
  authDomain: "promptly-c1eeb.firebaseapp.com",
  projectId: "promptly-c1eeb",
  storageBucket: "promptly-c1eeb.firebasestorage.app",
  messagingSenderId: "687270708164",
  appId: "1:687270708164:web:66fc9c9ed18badf07eda91"
};

// Only this email can log in to the admin panel.
// Anyone else who somehow logs in will be signed out immediately.
window.ADMIN_EMAIL = "tistudios17@gmail.com";

// ---------- Cloudinary ----------
window.CLOUDINARY_CONFIG = {
  cloudName:    "lhvm387x",
  uploadPreset: "promptly_uploads",
  folder:       "promptly"     // matches the folder set inside the preset
};
