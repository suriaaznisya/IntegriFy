import { auth, db } from "./firebase.js";
import { showAlert } from "./notify.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { loadHistory } from "./upload.js";

let isLoggingOut = false;
let guestMode = false;

function disableGuestMode() {
    guestMode = false;
}

// --------------------
// Register
// --------------------
document.getElementById("registerBtn").addEventListener("click", () => {
    const email = document.getElementById("registerEmail").value;
    const password = document.getElementById("registerPassword").value;
    const username = document.getElementById("registerUsername").value;

    disableGuestMode();

    if (!username) {
        showAlert("Missing information", "Please enter a username!", "warning");
        return;
    }

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            const user = userCredential.user;

            // Save username in Firestore
            setDoc(doc(db, "users", user.uid), {
                username: username,
                email: email,
                createdAt: new Date()
            })
            .then(() => {
                showAlert("Registration successful", "Your account is ready.", "success");
                window.showLogin(); // keep your original flow
            })
            .catch((err) => showAlert("Registration failed", err.message, "error"));
        })
        .catch((error) => showAlert("Registration failed", error.message, "error"));
});

// --------------------
// Login
// --------------------
document.getElementById("loginBtn").addEventListener("click", () => {
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    disableGuestMode();

    signInWithEmailAndPassword(auth, email, password)
        .then(() => {
            showAlert("Welcome back", "Login successful!", "success").then(() => {
                window.showHomepage();
            });
        })
        .catch((error) => showAlert("Login failed", error.message, "error"));
});

//Password Visibility
setupPasswordToggle("loginPassword", "toggleLoginPassword");
setupPasswordToggle("registerPassword", "toggleRegisterPassword");
function setupPasswordToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  const eyeOpen = toggle.querySelector(".eye-closed");
  const eyeClosed = toggle.querySelector(".eye-open");

  toggle.addEventListener("click", () => {
    const type = input.getAttribute("type") === "password" ? "text" : "password";
    input.setAttribute("type", type);

    if(type === "password") {
      eyeOpen.style.display = "block";
      eyeClosed.style.display = "none";
    } else {
      eyeOpen.style.display = "none";
      eyeClosed.style.display = "block";
    }
  });
}

// --------------------
// Logout
// --------------------
export async function logout() {
    try {
        if (guestMode) {
            guestMode = false;
            if (typeof window.showLogin === "function") {
                window.showLogin();
            }
            return;
        }

        isLoggingOut = true;
        disableGuestMode();
        await signOut(auth);
        await showAlert("Signed out", "See you next time!", "info");

    } catch (error) {
        isLoggingOut = false;
        await showAlert("Sign-out failed", error.message || "Unable to log out.", "error");
    }
}

export function enterGuestMode() {
    guestMode = true;
    if (typeof window.showHomepage === "function") {
        window.showHomepage();
    }
}

export function isGuestMode() {
    return guestMode;
}

// --------------------
// Auth state persistence
// --------------------
onAuthStateChanged(auth, async (user) => {

    if (user) {
        disableGuestMode();
        window.showHomepage();
        loadHistory();

        try {
            // Fetch username for future UI enhancements
            const profile = await getDoc(doc(db, "users", user.uid));
            if (profile.exists()) {
                const data = profile.data();
                console.log("Welcome,", data.username);
            }
        } catch (err) {
            console.warn("Unable to load user profile", err);
        }
    } else {
        if (isLoggingOut) {
            if (typeof window.showLogin === "function") {
                window.showLogin();
            }
            isLoggingOut = false;
        } else if (guestMode) {
            if (typeof window.showHomepage === "function") {
                window.showHomepage();
            }
        } else if (typeof window.showRegister === "function") {
            window.showRegister();
        }
        loadHistory();
    }
});

window.continueAsGuest = enterGuestMode;
