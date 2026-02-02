import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBClJ_q3_sCZaXiVap2NlXXyXef8xz1Crk",
  authDomain: "mupolic.firebaseapp.com",
  projectId: "mupolic",
  storageBucket: "mupolic.firebasestorage.app",
  messagingSenderId: "222195384073",
  appId: "1:222195384073:web:0bcafbd16d9b59c7eb9dd8",
  measurementId: "G-EG8N9J8TMW"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const postsCollection = collection(db, "policePosts");

signInAnonymously(auth);

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const map = L.map('map', { zoomControl: true }).setView([10.933, 108.283], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);

let markers = [];
let userMarker;
let watchId = null;
const STATIONARY_AGE = 30 * 60 * 1000;
const MOVING_AGE = 5 * 60 * 1000;

const LAST_ADD_KEY = 'lastAddTime';
function canAddPost() {
  const lastAdd = parseInt(localStorage.getItem(LAST_ADD_KEY) || '0');
  const now = Date.now();
  if (now - lastAdd < 60000) {
    tg.showAlert('Подождите минуту');
    return false;
  }
  return true;
}
function recordAdd() {
  localStorage.setItem(LAST_ADD_KEY, Date.now().toString());
}

// Реал-тайм посты
onSnapshot(postsCollection, (snapshot) => {
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const now = Date.now();
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (!data.timestamp?.seconds) return;
    const age = now - data.timestamp.seconds * 1000;
    const maxAge = data.type === 'moving' ? MOVING_AGE : STATIONARY_AGE;
    if (age > maxAge) return;

    const remaining = Math.floor((maxAge - age) / 60000);
    const iconSrc = data.type === 'moving' ? 'moving-icon.svg' : 'stationary-icon.svg';
    const direction = data.direction ? ` (${data.direction})` : '';
    const iconHtml = `<div style="position:relative;"><img src="${iconSrc}" style="width:32px;height:32px;"><div class="timer">${remaining} мин</div></div>`;
    const customIcon = L.divIcon({ html: iconHtml, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });

    L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map)
      .bindPopup(`Пост ДПС${direction}<br>Добавлен: ${new Date(data.timestamp.seconds * 1000).toLocaleTimeString()}<br><button onclick="deletePost('${docSnap.id}')">Удалить</button>`);
  });
});

// Добавление
document.getElementById('add-btn').addEventListener('click', () => {
  if (!canAddPost()) return;

  tg.showPopup({
    title: 'Тип поста',
    message: 'Что добавить?',
    buttons: [
      { type: 'default', id: 'stationary', text: 'Стоячий пост' },
      { type: 'default', id: 'moving', text: 'Движущийся фургон' },
      { type: 'cancel', text: 'Отмена' }
    ]
  }, (type) => {
    if (!type || type === 'cancel') return;

    tg.showPopup({
      title: 'Способ',
      message: 'Как добавить?',
      buttons: [
        { type: 'default', id: 'geo', text: 'По геолокации' },
        { type: 'default', id: 'manual', text: 'Тап на карте' },
        { type: 'cancel', text: 'Отмена' }
      ]
    }, (method) => {
      if (!method || method === 'cancel') return;

      if (method === 'geo') {
        navigator.geolocation.getCurrentPosition(
          pos => finalizeAdd(type, pos.coords.latitude, pos.coords.longitude),
          () => tg.showAlert('Включите геолокацию')
        );
      } else {
        tg.showAlert('Тапните на карту');
        map.once('click', e => finalizeAdd(type, e.latlng.lat, e.latlng.lng));
      }
    });
  });
});

function finalizeAdd(type, lat, lng) {
  if (type === 'stationary') {
    savePost(type, lat, lng, null);
  } else {
    tg.showPopup({
      title: 'Направление',
      message: 'Куда ехал?',
      buttons: [
        { type: 'default', id: 'N', text: 'Север' },
        { type: 'default', id: 'S', text: 'Юг' },
        { type: 'default', id: 'E', text: 'Восток' },
        { type: 'default', id: 'W', text: 'Запад' },
        { type: 'cancel', text: 'Отмена' }
      ]
    }, dir => {
      if (dir && dir !== 'cancel') savePost(type, lat, lng, dir);
    });
  }
}

async function savePost(type, lat, lng, direction) {
  try {
    await addDoc(postsCollection, { type, lat, lng, direction, timestamp: serverTimestamp() });
    recordAdd();
    tg.showAlert('Пост добавлен!');
  } catch (err) {
    tg.showAlert('Ошибка: ' + err.message);
  }
}

window.deletePost = id => deleteDoc(doc(db, "policePosts", id));

// Моя позиция
document.getElementById('location-btn').addEventListener('click', () => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (userMarker) map.removeLayer(userMarker);
    document.getElementById('location-btn').textContent = 'Моя позиция';
    return;
  }

  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude } = pos.coords;
    if (!userMarker) userMarker = L.marker([latitude, longitude], { icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [24, 24] }) }).addTo(map);
    userMarker.setLatLng([latitude, longitude]);
    map.panTo([latitude, longitude]);
  });

  document.getElementById('location-btn').textContent = 'Остановить';
});