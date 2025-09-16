// ======================================================
// auth.js — Firebase Auth (compat) + flip Sign-in/Sign-up modal
// (No Firestore favourites logic; owned by favorites.js)
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyB6r0uy6cTwo7KKbI-HGW9E_OX2Z0dDgtc",
  authDomain: "circeco-bf511.firebaseapp.com",
  projectId: "circeco-bf511",
  messagingSenderId: "141138113054",
  appId: "1:141138113054:web:9edc9ce0553984f8c3b40f"
};

// --- Firebase (compat) init ---
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
// Optional: you can initialise firestore here if other parts need it, but do NOT
// perform favourites reads/writes in this file.
firebase.firestore();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// ======================================================
// UI elements (header + modal)
// ======================================================
const authModal     = document.getElementById("authModal");
const loginBtn      = document.getElementById("loginBtn");
const logoutBtn     = document.getElementById("logoutBtn");
const profileMenu   = document.getElementById("profileMenu");
const avatarImg     = document.getElementById("avatar");
const emailEl       = document.getElementById("userEmail");

// Flip container
const flipEl        = document.getElementById("flip");

// Forms & fields
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

const toSignupLink  = document.getElementById("toSignup"); // href="#flip"
const toSigninLink  = document.getElementById("toSignin"); // href="#"

// ======================================================
// Modal helpers + flip control
// ======================================================

function clearHash() {
  history.replaceState(null, "", location.pathname + location.search);
}
function forceFront() {
  if (flipEl) flipEl.style.transform = "rotateY(0deg)";
}
function allowCssFlip() {
  if (flipEl) flipEl.style.transform = "";
}

function showAuth() {
  if (!authModal) return;
  clearHash();
  forceFront();
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
  clearHash();
  forceFront();
}

// Expose modal opener for map/favorites modules
window.circeco = window.circeco || {};
window.circeco.openAuthModal = showAuth;

// Open/close
loginBtn  && loginBtn.addEventListener("click", showAuth);
logoutBtn && logoutBtn.addEventListener("click", () => auth.signOut());

// Outside click to close
authModal && authModal.addEventListener("click", (e) => {
  if (e.target === authModal) hideAuth();
});

// Flip links
toSignupLink && toSignupLink.addEventListener("click", () => {
  allowCssFlip(); // allow CSS :target to rotate
  // href="#flip" will set the hash
});
toSigninLink && toSigninLink.addEventListener("click", (e) => {
  e.preventDefault();
  clearHash();
  forceFront();
});

// ======================================================
// Submit handlers
// ======================================================

// SIGN IN
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

// SIGN UP
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
// Header state rendering (UI only)
// ======================================================
auth.onAuthStateChanged((user) => {
  if (user) {
    if (loginBtn)    loginBtn.style.display = "none";
    if (profileMenu) profileMenu.style.display = "";
    if (avatarImg)   avatarImg.src = "assets/img/avatar.png";
    if (emailEl)     emailEl.textContent = user.email;
  } else {
    if (profileMenu) profileMenu.style.display = "none";
    if (loginBtn)    loginBtn.style.display = "";
    if (emailEl)     emailEl.textContent = "";
  }

  // Tell favourites module (centralised owner) about auth changes
  try {
    window.dispatchEvent(new CustomEvent('favorites:auth', {
      detail: { user: user ? { uid: user.uid, email: user.email || null } : null }
    }));
  } catch {}
});

