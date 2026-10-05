import { initializeApp, getApps, getApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"
import { getAuth } from "firebase/auth"
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey: "AIzaSyBbVgvwq0bkM_TFx505qLvO84o1xkJvJZA",
  authDomain: "waste-connect-c0873.firebaseapp.com",
  projectId: "waste-connect-c0873",
  storageBucket: "waste-connect-c0873.appspot.com",
  messagingSenderId: "752621142720",
  appId: "1:752621142720:web:74f1f9282e7d4b4202a325",
  measurementId: "G-5Z7K6NS8JK",
}

// ✅ Prevent multiple Firebase app instances
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

export const db = getFirestore(app)
export const auth = getAuth(app)
export const storage = getStorage(app)

export default app
