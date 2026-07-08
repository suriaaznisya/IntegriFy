// Modular Firebase v10+ Initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDfKfCTKDKSjPXZqdI5o307TmPXLO218BQ",
    authDomain: "integrify-dc501.firebaseapp.com",
    projectId: "integrify-dc501",
    storageBucket: "integrify-dc501.firebasestorage.app",
    messagingSenderId: "260012733279",
    appId: "1:260012733279:web:7ca3f7971d5eb6d2a37cea",
    measurementId: "G-79DNDF09LM"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
