import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
    tg.showAlert('Подождите минуту перед добавлением нового поста.');
    return false;
  }
  return true;
}
function recordAdd() {
  localStorage.setItem(LAST_ADD_KEY, Date.now().toString());
}

// Реал-тайм слушатель (посты обновляются мгновенно)
function setupRealtimeUpdates() {
  const now = Date.now();
  const q = query(postsCollection, where("timestamp", ">", now - Math.max(STATIONARY_AGE, MOVING_AGE)));
  onSnapshot(q, (snapshot) => {
    // Очистка старых маркеров
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const currentTime = Date.now();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.timestamp || !data.timestamp.seconds) return;
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
        className: 'marker-fade marker-visible',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map)
        .bindPopup(`Пост ДПС${direction}<br>Добавлен: ${new Date(data.timestamp.seconds * 1000).toLocaleTimeString()}<br><button onclick="deletePost('${docSnap.id}')">Удалить</button>`);

      markers.push(marker);
    });
  });
}
setupRealtimeUpdates(); // Запуск реал-тайм

document.getElementById('add-btn').addEventListener('click', () => {
  if (!canAddPost()) return;

  tg.showPopup({
    title: 'Добавить пост',
    message: 'Выберите тип',
    buttons: [
      { type: 'default', id: 'stationary', text: 'Стоячий пост' },
      { type: 'cancel', text: 'Отмена' }
    ]
  }, (typeId) => {
    if (typeId !== 'stationary') return;
    chooseAddMethod(typeId);
  });
});

function chooseAddMethod(type) {
  tg.showPopup({
    title: 'Способ добавления',
    message: 'Выберите способ',
    buttons: [
      { type: 'default', id: 'geo', text: 'По геолокации' },
      { type: 'default', id: 'manual', text: 'Вручную (тап)' },
      { type: 'cancel', text: 'Отмена' }
    ]
  }, (methodId) => {
    if (!methodId) return;
    if (methodId === 'geo') {
      navigator.geolocation.getCurrentPosition(
        (pos) => handlePostAddition(type, pos.coords.latitude, pos.coords.longitude),
        () => tg.showAlert('Разрешите доступ к геолокации в настройках Telegram/браузера'),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      tg.showAlert('Тапните на карту для выбора точки');
      map.once('click', (e) => {
        handlePostAddition(type, e.latlng.lat, e.latlng.lng);
      });
    }
  });
}

function handlePostAddition(type, lat, lng) {
  if (type === 'stationary') {
    addPostToDb(type, lat, lng, null);
  } else {
    tg.showPopup({
      title: 'Направление',
      message: 'Куда ехал фургон?',
      buttons: [
        { type: 'default', id: 'N', text: 'Север' },
        { type: 'default', id: 'S', text: 'Юг' },
        { type: 'default', id: 'E', text: 'Восток' },
        { type: 'default', id: 'W', text: 'Запад' },
        { type: 'cancel', text: 'Отмена' }
      ]
    }, (dir) => {
      if (dir) addPostToDb(type, lat, lng, dir);
    });
  }
}

async function addPostToDb(type, lat, lng, direction) {
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
    tg.showAlert('Пост успешно добавлен! Виден всем сразу.');
  } catch (err) {
    tg.showAlert('Ошибка добавления: ' + err.message);
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

// Кнопка "Моя позиция"
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
    map.panTo([latitude, longitude]); // Только центр, без зума

    markers.forEach(m => {
      const dist = map.distance([latitude, longitude], m.getLatLng());
      if (dist < 500) {
        tg.HapticFeedback.notificationOccurred('warning');
        tg.showAlert(`ДПС рядом! ~${Math.round(dist)} м`);
      }
    });
  }, (err) => tg.showAlert('Геолокация недоступна'), { enableHighAccuracy: true });

  document.getElementById('location-btn').textContent = 'Остановить';
});

// Тема
if (tg.themeParams) {
  document.body.style.backgroundColor = tg.themeParams.bg_color || '#121212';
}