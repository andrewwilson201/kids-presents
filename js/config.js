// Firebase web app config for the app's own project (kids-presents),
// from Firebase console › Project settings › Your apps.
// These values are public by design: access is controlled by Firebase Auth and
// the Firestore security rules in firestore.rules, not by keeping this secret.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBw_ajS41WOkAlCQSvLjC_WPdX_bWzW-Ew',
  authDomain: 'kids-presents.firebaseapp.com',
  projectId: 'kids-presents',
  storageBucket: 'kids-presents.firebasestorage.app',
  messagingSenderId: '61389624990',
  appId: '1:61389624990:web:7ddcc43e79b7442ece8d8f',
};

// Web push key for phone notifications, from Firebase console › Project settings ›
// Cloud Messaging › Web Push certificates. Public by design, like the config above.
export const VAPID_KEY = 'BOZMAklGfmU6YoXoe2ecwdcbETz19hBbnvA_EozV5zopp8qraAICRsDKF5VYhF7ewgNSWf3621tKYJTMWz5xLYs';
