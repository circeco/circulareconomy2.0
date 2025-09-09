// ======================================================
// auth.js — Firebase Auth (compat) + custom email/password form
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyB6r0uy6cTwo7KKbI-HGW9E_OX2Z0dDgtc",
  authDomain: "circeco-bf511.firebaseapp.com",
  projectId: "circeco-bf511",
  // storageBucket not needed for this app
  messagingSenderId: "141138113054",
  appId: "1:141138113054:web:9edc9ce0553984f8c3b40f"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// ---------- UI elements ----------
const authModal     = document.getElementById("authModal");
const loginBtn      = document.getElementById("loginBtn");
const logoutBtn     = document.getElementById("logoutBtn");
const profileMenu   = document.getElementById("profileMenu");
const avatarImg     = document.getElementById("avatar");

// custom form elems
const form          = document.getElementById("emailPassForm");
const emailInput    = document.getElementById("authEmail");
const passInput     = document.getElementById("authPassword");
const errorBox      = document.getElementById("authError");
const submitBtn     = document.getElementById("authSubmit");
const cancelBtn     = document.getElementById("authCancel");
const toggleLink    = document.getElementById("authToggle");
const titleEl       = document.getElementById("authTitle");
const toggleLine    = document.getElementById("authToggleLine");

// ---------- modal helpers ----------
function showAuth() {
  if (!authModal) return;
  errorBox.textContent = "";
  submitBtn.disabled = false;
  passInput.value = "";
  authMode = "signin";
  renderMode();
  authModal.style.display = "flex";
}
function hideAuth() {
  if (!authModal) return;
  authModal.style.display = "none";
}

// ---------- single-step email+password logic ----------
let authMode = "signin"; // 'signin' | 'signup'

function renderMode() {
  if (authMode === "signin") {
    titleEl.textContent = "Sign in";
    submitBtn.textContent = "Sign in";
    toggleLine.innerHTML = `Don’t have an account? <a href="#" id="authToggle">Create one</a>`;
  } else {
    titleEl.textContent = "Create account";
    submitBtn.textContent = "Create account";
    toggleLine.innerHTML = `Already have an account? <a href="#" id="authToggle">Sign in</a>`;
  }
  // rebind toggle after replacing innerHTML
  document.getElementById("authToggle").addEventListener("click", (e) => {
    e.preventDefault();
    authMode = authMode === "signin" ? "signup" : "signin";
    errorBox.textContent = "";
    renderMode();
  });
}

loginBtn  && loginBtn.addEventListener("click", showAuth);
cancelBtn && cancelBtn.addEventListener("click", hideAuth);
logoutBtn && logoutBtn.addEventListener("click", () => auth.signOut());

// submit handler: tries the chosen mode
form && form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";
  submitBtn.disabled = true;

  const email = emailInput.value.trim();
  const pass  = passInput.value;

  try {
    if (authMode === "signin") {
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      console.log("Signed in:", cred.user.email);
      hideAuth();
    } else {
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      console.log("Created:", cred.user.email);
      hideAuth();
    }
  } catch (err) {
    console.error("Auth error:", err.code, err.message);

    // helpful auto-switch: if trying to sign in but user doesn't exist → suggest sign up
    if (authMode === "signin" && err.code === "auth/user-not-found") {
      authMode = "signup";
      renderMode();
      errorBox.textContent = "We couldn’t find that email. Create an account to continue.";
    } else if (authMode === "signup" && err.code === "auth/email-already-in-use") {
      authMode = "signin";
      renderMode();
      errorBox.textContent = "This email already exists. Please sign in.";
    } else if (err.code === "auth/wrong-password") {
      errorBox.textContent = "Wrong password. Try again.";
    } else if (err.code === "auth/weak-password") {
      errorBox.textContent = "Password should be at least 6 characters.";
    } else {
      errorBox.textContent = err.message;
    }
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- header state & favourites ----------
auth.onAuthStateChanged(async (user) => {
  if (user) {
    if (loginBtn)    loginBtn.style.display = "none";
    if (profileMenu) profileMenu.style.display = "";
    if (avatarImg)   avatarImg.src = user.photoURL || "https://www.gravatar.com/avatar/?d=mp&s=64";
    try { await loadFavourites(user.uid); } catch (e) { console.error(e); }
  } else {
    if (profileMenu) profileMenu.style.display = "none";
    if (loginBtn)    loginBtn.style.display = "";
    try { clearFavouritesFromMap(); } catch {}
    try { renderFavouritesDropdown([]); } catch {}
  }
});

// ---------- Firestore helpers for favourites ----------
async function saveFavouriteSpot(uid, spot) {
  if (!uid) throw new Error("UID mancante");
  if (typeof spot?.lat !== "number" || typeof spot?.lng !== "number")
    throw new Error("Coordinate non valide");

  return db.collection("users").doc(uid).collection("favourites").add({
    name: spot.name || "Senza nome",
    lat: spot.lat,
    lng: spot.lng,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function loadFavourites(uid) {
  if (!uid) return [];
  const snap = await db.collection("users").doc(uid).collection("favourites")
    .orderBy("createdAt", "desc").get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (typeof window.renderFavouritesOnMap === "function") window.renderFavouritesOnMap(items);
  if (typeof renderFavouritesDropdown === "function") renderFavouritesDropdown(items);
  return items;
}

async function deleteFavourite(uid, favId) {
  if (!uid || !favId) return;
  return db.collection("users").doc(uid).collection("favourites").doc(favId).delete();
}

// Public API for mapbox.js
window.saveFavouriteSpot = async (spot) => {
  const user = auth.currentUser;
  if (!user) { showAuth(); return; }
  await saveFavouriteSpot(user.uid, spot);
  await loadFavourites(user.uid);
};
window.deleteFavouriteSpot = async (favId) => {
  const user = auth.currentUser;
  if (!user) return;
  await deleteFavourite(user.uid, favId);
  await loadFavourites(user.uid);
};

// Safe stubs
window.renderFavouritesOnMap  = window.renderFavouritesOnMap  || function(){};
window.clearFavouritesFromMap = window.clearFavouritesFromMap || function(){};

// ---------- (Optional) Firestore rules reminder ----------
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{uid}/favourites/{docId} {
//       allow read, write: if request.auth != null && request.auth.uid == uid;
//     }
//   }
// }
