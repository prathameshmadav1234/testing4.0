// Background Firebase Logging Script (can be used as a module or script)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLAKW51iGzR68EL-ZPWxraFz-NTdNJPqM",
  authDomain: "esp32ledcontrol-c0d28.firebaseapp.com",
  databaseURL: "https://esp32ledcontrol-c0d28-default-rtdb.firebaseio.com",
  projectId: "esp32ledcontrol-c0d28",
  storageBucket: "esp32ledcontrol-c0d28.appspot.com",
  messagingSenderId: "616534198261",
  appId: "1:616534198261:web:5c6848fdec9d01c9c6c2bc"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

const firebaseUrl = "https://esp32ledcontrol-c0d28-default-rtdb.firebaseio.com/led.json";

let currentUser = null;
let updateTimer = null;
let lastEntry = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    uploadStoredLogs(); // Upload any stored logs on login
    startUpdater(); // Start updater when logged in
  } else {
    stopUpdater(); // Stop updater when logged out
  }
});

async function fetchData() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const res = await fetch(firebaseUrl + "?t=" + Date.now());
    const data = await res.json();
    const now = new Date();
    const time = now.toLocaleTimeString();
    const ledState = data.real_state === 1 ? "ON" : "OFF";
    const brightness = data.brightness_percent ?? "N/A";
    const potValue = data.pot_value ?? "N/A";
    const entry = { time, ledState, brightness, potValue, timestamp: now.getTime() };

    // Check for duplicates to avoid multiple pushes from different devices
    if (!lastEntry || JSON.stringify(lastEntry) !== JSON.stringify(entry)) {
      if (currentUser) {
        // Push to Firebase under /logs/{userUID}/{date}
        const logsRef = ref(database, `logs/${currentUser.uid}/${today}`);
        await push(logsRef, entry);
        console.log("Logged data to Firebase:", entry);
      } else {
        // Store in localStorage
        const storedLogs = JSON.parse(localStorage.getItem('esp32Logs') || '[]');
        storedLogs.push(entry);
        localStorage.setItem('esp32Logs', JSON.stringify(storedLogs));
        console.log("Stored data in localStorage:", entry);
      }
      lastEntry = entry;
    }
  } catch (e) {
    console.error("Fetch error:", e);
  }
}

function startUpdater() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(fetchData, 10000);
}

function stopUpdater() {
  if (updateTimer) clearInterval(updateTimer);
}

async function uploadStoredLogs() {
  const storedLogs = JSON.parse(localStorage.getItem('esp32Logs') || '[]');
  if (storedLogs.length === 0 || !currentUser) return;

  const today = new Date().toISOString().split("T")[0];
  const logsRef = ref(database, `logs/${currentUser.uid}/${today}`);

  for (const entry of storedLogs) {
    await push(logsRef, entry);
    console.log("Uploaded stored log to Firebase:", entry);
  }

  localStorage.removeItem('esp32Logs');
  console.log("Uploaded and cleared stored logs");
}

// Do not start updater here, let Service Worker handle it
