import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

signInAnonymously(auth).catch((error) => console.error("Auth error:", error));

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const map = L.map('map', { zoomControl: true }).setView([10.933, 108.283], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

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
    tg.showAlert('Подождите минуту перед новым постом (антиспам).');
    return false;
  }
  return true;
}
function recordAdd() {
  localStorage.setItem(LAST_ADD_KEY, Date.now().toString());
}

// Реал-тайм обновления постов
function setupRealtimeUpdates() {
  const now = Date.now();
  const q = query(postsCollection, where("timestamp", ">", now - Math.max(STATIONARY_AGE, MOVING_AGE)));
  onSnapshot(q, (snapshot) => {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const currentTime = Date.now();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.timestamp?.seconds) return;
      const age = currentTime - data.timestamp.seconds * 1000;
      const maxAge = data.type === 'moving' ? MOVING_AGE : STATIONARY_AGE;
      const remaining = Math.max(0, (maxAge - age) / 1000 / 60);
      if (remaining <= 0) return;

      const iconSrc = data.type === 'moving' ? 'moving-icon.svg' : 'stationary-icon.svg';
      const direction = data.direction ? ` (${data.direction})` : '';
      const iconHtml = `
        <div style="position: relative;">
          <img src="${iconSrc}" style="width:32px;height:32px;">
          <div class="timer">${Math.floor(remaining)} мин</div>
        </div>
      `;
      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'marker-visible',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map)
        .bindPopup(`Пост ДПС${direction}<br>Добавлен: ${new Date(data.timestamp.seconds * 1000).toLocaleTimeString()}<br><button onclick="deletePost('${docSnap.id}')">Удалить</button>`);

      markers.push(marker);
    });
  }, (error) => console.error("Realtime error:", error));
}
setupRealtimeUpdates();

// Добавление поста
let isAdding = false; // Защита от множественных кликов
document.getElementById('add-btn').addEventListener('click', () => {
  if (isAdding || !canAddPost()) return;
  isAdding = true;

  tg.showPopup({
    title: 'Добавить пост ДПС',
    message: 'Выберите тип',
    buttons: [
      { type: 'default', id: 'stationary', text: 'Стоячий пост' },
      { type: 'default', id: 'moving', text: 'Движущийся фургон' },
      { type: 'cancel', text: 'Отмена' }
    ]
  }, (typeId) => {
    isAdding = false;
    if (!typeId || typeId === 'cancel') return;
    chooseMethod(typeId);
  });
});

function chooseMethod(type) {
  tg.showPopup({
    title: 'Способ добавления',
    message: 'Как добавить?',
    buttons: [
      { type: 'default', id: 'geo', text: 'По моей геолокации' },
      { type: 'default', id: 'manual', text: 'Вручную (тап на карте)' },
      { type: 'cancel', text: 'Отмена' }
    ]
  }, (methodId) => {
    if (!methodId || methodId === 'cancel') return;

    if (methodId === 'geo') {
      navigator.geolocation.getCurrentPosition(
        (pos) => addWithDirection(type, pos.coords.latitude, pos.coords.longitude),
        () => tg.showAlert('Включите геолокацию в настройках Telegram/устройства'),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } else {
      tg.showAlert('Тапните на карту для точки');
      map.once('click', (e) => addWithDirection(type, e.latlng.lat, e.latlng.lng));
    }
  });
}

function addWithDirection(type, lat, lng) {
  if (type === 'stationary') {
    savePost(type, lat, lng, null);
  } else {
    tg.showPopup({
      title: 'Направление фургона',
      message: 'Куда ехал?',
      buttons: [
        { type: 'default', id: 'N', text: 'Север' },
        { type: 'default', id: 'S', text: 'Юг' },
        { type: 'default', id: 'E', text: 'Восток' },
        { type: 'default', id: 'W', text: 'Запад' },
        { type: 'cancel', text: 'Отмена' }
      ]
    }, (dir) => {
      if (dir && dir !== 'cancel') savePost(type, lat, lng, dir);
    });
  }
}

async function savePost(type, lat, lng, direction) {
  try {
    await addDoc(postsCollection, {
      type,
      lat,
      lng,
      direction,
      timestamp: serverTimestamp(),
      userId: tg.initDataUnsafe?.user?.id || 'anonymous'
    });
    recordAdd();
    tg.HapticFeedback.success();
    tg.showAlert('Пост добавлен и виден всем!');
  } catch (err) {
    tg.showAlert('Ошибка: ' + err.message);
  }
}

window.deletePost = async (id) => {
  try {
    await deleteDoc(doc(db, "policePosts", id));
    tg.showAlert('Пост удалён');
  } catch (err) {
    tg.showAlert('Ошибка удаления');
  }
};

// Моя позиция (трекинг)
document.getElementById('location-btn').addEventListener('click', () => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (userMarker) map.removeLayer(userMarker);
    document.getElementById('location-btn').textContent = 'Моя позиция';
    return;
  }

  watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    if (!userMarker) {
      userMarker = L.marker([latitude, longitude], {
        icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [24, 24], iconAnchor: [12, 24] })
      }).addTo(map);
    } else {
      userMarker.setLatLng([latitude, longitude]);
    }
    map.panTo([latitude, longitude]);

    markers.forEach(m => {
      const dist = map.distance([latitude, longitude], m.getLatLng());
      if (dist < 500) {
        tg.HapticFeedback.notificationOccurred('warning');
        tg.showAlert(`ДПС рядом! ~${Math.round(dist)} м`);
      }
    });
  }, (err) => tg.showAlert('Геолокация выключена'), { enableHighAccuracy: true });

  document.getElementById('location-btn').textContent = 'Остановить';
});

// Тема
if (tg.themeParams) {
  document.body.style.backgroundColor = tg.themeParams.bg_color || '#121212';
}