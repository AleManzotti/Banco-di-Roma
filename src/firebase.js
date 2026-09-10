import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBpkqw5bxMw2cLd5oEcbXNJh34-EVY7P08",
  authDomain: "banco-di-roma.firebaseapp.com",
  projectId: "banco-di-roma",
  storageBucket: "banco-di-roma.firebasestorage.app",
  messagingSenderId: "553006169355",
  appId: "1:553006169355:web:fd228092d39330dc8ab60e",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
