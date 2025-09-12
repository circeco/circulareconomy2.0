// ======================================================
// auth.js — Firebase Auth (compat) + flip Sign-in/Sign-up + Firestore favourites
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyB6r0uy6cTwo7KKbI-HGW9E_OX2Z0dDgtc",
  authDomain: "circeco-bf511.firebaseapp.com",
  projectId: "circeco-bf511",
  // storageBucket not needed for this app
  messagingSenderId: "141138113054",
  appId: "1:141138113054:web:9edc9ce0553984f8c3b40f"
};

// --- Firebase (compat) init ---
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// Persist session locally (default is LOCAL, but explicit is nice)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// ======================================================
// UI elements (header + modal)
// ======================================================
const authModal     = document.getElementById("authModal");
const loginBtn      = document.getElementById("loginBtn");
const logoutBtn     = document.getElementById("logoutBtn");
const profileMenu   = document.getElementById("profileMenu");
const avatarImg     = document.getElementById("avatar");

// Flip container
const flipEl        = document.getElementById("flip");

// Forms & fields (unique IDs per face!)
const signInForm    = document.getElementById("signInForm");
const signInEmail   = document.getElementById("signInEmail");
const signInPass    = document.getElementById("signInPass");
const signInError   = document.getElementById("signInError");
const signInSubmit  = document.getElementById("signInSubmit");

const signUpForm    = document.getElementById("signUpForm");
const signUpEmail   = document.getElementById("signUpEmail");
const signUpPass    = document.getElementById("signUpPass");
const signUpError   = document.getElementById("signUpError");
const signUpSubmit  = document.getElementById("signUpSubmit");

const toSignupLink  = document.getElementById("toSignup"); // href="#flip" (flip to back)
const toSigninLink  = document.getElementById("toSignin"); // href="#"     (flip to front)

// ======================================================
// Modal helpers + flip control
// ======================================================

// Helper: clear the URL hash without scrolling
function clearHash() {
  history.replaceState(null, "", location.pathname + location.search);
}

// Force the card to show the SIGN-IN face (front) visually
function forceFront() {
  if (flipEl) flipEl.style.transform = "rotateY(0deg)"; // inline style wins over :target
}

// Allow CSS :target to control the flip (remove our override)
function allowCssFlip() {
  if (flipEl) flipEl.style.transform = ""; // remove inline override
}

function showAuth() {
  if (!authModal) return;

  // Always open on SIGN IN (front)
  clearHash();     // ensure #flip is not targeted
  forceFront();    // visually guarantee front face

  // reset both forms
  if (signInError) signInError.textContent = "";
  if (signUpError) signUpError.textContent = "";
  if (signInSubmit) signInSubmit.disabled = false;
  if (signUpSubmit) signUpSubmit.disabled = false;
  if (signInPass)  signInPass.value = "";
  if (signUpPass)  signUpPass.value = "";

  authModal.style.display = "flex";
}

function hideAuth() {
  if (!authModal) return;
  authModal.style.display = "none";
  // ensure next open starts at Sign in face
  clearHash();
  forceFront();
}

// Open/close
loginBtn  && loginBtn.addEventListener("click", showAuth);
logoutBtn && logoutBtn.addEventListener("click", () => auth.signOut());

// Outside click to close
authModal && authModal.addEventListener("click", (e) => {
  if (e.target === authModal) hideAuth();
});

// IMPORTANT: let the anchors change hash for CSS flip, but sync our override
toSignupLink && toSignupLink.addEventListener("click", () => {
  // Going to Sign-up: allow CSS :target to rotate the card
  allowCssFlip();
  // (no preventDefault—href="#flip" should set the hash)
});
toSigninLink && toSigninLink.addEventListener("click", (e) => {
  // Back to Sign-in: keep URL clean and force front
  e.preventDefault();
  clearHash();
  forceFront();
});

// ======================================================
// Submit handlers
// ======================================================

// SIGN IN (front)
signInForm && signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signInError)  signInError.textContent = "";
  if (signInSubmit) signInSubmit.disabled = true;

  const email = (signInEmail?.value || "").trim();
  const pass  = signInPass?.value || "";

  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    console.log("Signed in:", cred.user.email);
    hideAuth();
  } catch (err) {
    console.error("SIGNIN error:", err.code, err.message);
    if (err.code === "auth/user-not-found") {
      // Suggest signup: flip to back, prefill email there
      allowCssFlip();
      location.hash = "#flip";
      if (signUpEmail) signUpEmail.value = email;
      if (signInError) signInError.textContent = "No account found. Create one on the other side.";
    } else if (err.code === "auth/wrong-password") {
      if (signInError) signInError.textContent = "Wrong password. Try again.";
    } else {
      if (signInError) signInError.textContent = err.message;
    }
  } finally {
    if (signInSubmit) signInSubmit.disabled = false;
  }
});

// SIGN UP (back)
signUpForm && signUpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signUpError)  signUpError.textContent = "";
  if (signUpSubmit) signUpSubmit.disabled = true;

  const email = (signUpEmail?.value || "").trim();
  const pass  = signUpPass?.value || "";

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    console.log("Created:", cred.user.email);
    hideAuth();
  } catch (err) {
    console.error("SIGNUP error:", err.code, err.message);
    if (err.code === "auth/email-already-in-use") {
      // Suggest sign in: go to front, prefill email
      clearHash();
      forceFront();
      if (signInEmail) signInEmail.value = email;
      if (signUpError) signUpError.textContent = "Email already in use. Please sign in.";
    } else if (err.code === "auth/weak-password") {
      if (signUpError) signUpError.textContent = "Password should be at least 6 characters.";
    } else {
      if (signUpError) signUpError.textContent = err.message;
    }
  } finally {
    if (signUpSubmit) signUpSubmit.disabled = false;
  }
});

// ======================================================
// Header state & favourites rendering
// ======================================================
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

// ======================================================
// Firestore helpers for favourites
// ======================================================
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

// Safe stubs (avoid errors if map hooks aren't defined yet)
window.renderFavouritesOnMap  = window.renderFavouritesOnMap  || function(){};
window.clearFavouritesFromMap = window.clearFavouritesFromMap || function(){};

// ======================================================
// Firestore Rules (for reference)
// ======================================================
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{uid}/favourites/{docId} {
//       allow read, write: if request.auth != null && request.auth.uid == uid;
//     }
//   }
// }
