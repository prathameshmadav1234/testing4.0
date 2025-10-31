// Service Worker for background logging
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCLAKW51iGzR68EL-ZPWxraFz-NTdNJPqM",
  authDomain: "esp32ledcontrol-c0d28.firebaseapp.com",
  databaseURL: "https://esp32ledcontrol-c0d28-default-rtdb.firebaseio.com",
  projectId: "esp32ledcontrol-c0d28",
  storageBucket: "esp32ledcontrol-c0d28.appspot.com",
  messagingSenderId: "616534198261",
  appId: "1:616534198261:web:5c6848fdec9d01c9c6c2bc"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

const firebaseUrl = "https://esp32ledcontrol-c0d28-default-rtdb.firebaseio.com/led.json";

let currentUser = null;
let updateTimer = null;
let lastEntry = null;

// Load user from IndexedDB on SW start
loadUserFromIndexedDB().then(user => {
  currentUser = user;
  if (currentUser) {
    startUpdater();
  }
});

// Listen for messages from main thread to set user
self.addEventListener('message', (event) => {
  if (event.data.type === 'setUser') {
    currentUser = event.data.userId ? { uid: event.data.userId } : null;
    storeUserInIndexedDB(currentUser);
    if (currentUser) {
      uploadStoredLogs(); // Upload any stored logs on login
      startUpdater(); // Start updater when logged in
    } else {
      stopUpdater(); // Stop updater when logged out
    }
  }
});

// Listen for periodic sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'fetch-data') {
    event.waitUntil(fetchData());
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

    // Check for duplicates
    if (!lastEntry || JSON.stringify(lastEntry) !== JSON.stringify(entry)) {
      if (currentUser) {
        const logsRef = database.ref(`logs/${currentUser.uid}/${today}`);
        await logsRef.push(entry);
        console.log("Logged data to Firebase:", entry);
      } else {
        // Store in IndexedDB since localStorage not available in SW
        storeInIndexedDB(entry);
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
  const storedLogs = await getFromIndexedDB();
  if (storedLogs.length === 0 || !currentUser) return;

  const today = new Date().toISOString().split("T")[0];
  const logsRef = database.ref(`logs/${currentUser.uid}/${today}`);

  for (const entry of storedLogs) {
    await logsRef.push(entry);
    console.log("Uploaded stored log to Firebase:", entry);
  }

  clearIndexedDB();
}

function storeInIndexedDB(entry) {
  // Simple IndexedDB storage
  const request = indexedDB.open('esp32Logs', 1);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('logs')) {
      db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
    }
  };
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.add(entry);
  };
}

function getFromIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('esp32Logs', 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['logs'], 'readonly');
      const store = transaction.objectStore('logs');
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => {
        resolve(getAllRequest.result);
      };
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      }
      resolve([]);
    };
  });
}

function clearIndexedDB() {
  const request = indexedDB.open('esp32Logs', 1);
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.clear();
  };
}

function storeUserInIndexedDB(user) {
  const request = indexedDB.open('esp32Logs', 1);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('user')) {
      db.createObjectStore('user', { keyPath: 'id' });
    }
  };
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['user'], 'readwrite');
    const store = transaction.objectStore('user');
    store.put({ id: 'currentUser', user: user });
  };
}

function loadUserFromIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('esp32Logs', 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['user'], 'readonly');
      const store = transaction.objectStore('user');
      const getRequest = store.get('currentUser');
      getRequest.onsuccess = () => {
        resolve(getRequest.result ? getRequest.result.user : null);
      };
      getRequest.onerror = () => {
        resolve(null);
      };
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'id' });
      }
      resolve(null);
    };
  });
}

// Install and activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
