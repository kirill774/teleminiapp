import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
const UPDATE_INTERVAL = 10000;

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

async function updatePosts() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const now = Date.now();
  const snapshot = await getDocs(query(postsCollection, where("timestamp", ">", now - Math.max(STATIONARY_AGE, MOVING_AGE))));
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    if (!data.timestamp || !data.timestamp.seconds) return;
    const age = now - data.timestamp.seconds * 1000;
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
      className: 'marker-fade',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map)
      .bindPopup(`Пост ДПС${direction}<br>Добавлен: ${new Date(data.timestamp.seconds * 1000).toLocaleTimeString()}<br><button onclick="deletePost('${docSnap.id}')">Удалить</button>`);

    setTimeout(() => marker._icon.classList.add('marker-visible'), 100);
    markers.push(marker);
  });
}
setInterval(updatePosts, UPDATE_INTERVAL);
updatePosts();

document.getElementById('add-btn').addEventListener('click', () => {
  if (!canAddPost()) return;

  tg.showPopup({
    title: 'Добавить пост',
    message: 'Выберите тип',
    buttons: [
      { type: 'default', id: 'stationary', text: 'Стоячий пост' },
      { type: 'default', id: 'moving', text: 'Движущийся фургон' }
    ]
  }, (typeId) => {
    if (!typeId) return;
    tg.showPopup({
      title: 'Способ добавления',
      message: 'Выберите способ',
      buttons: [
        { type: 'default', id: 'geo', text: 'По геолокации' },
        { type: 'default', id: 'manual', text: 'Вручную (тап на карте)' }
      ]
    }, async (methodId) => {
      if (!methodId) return;
      let lat, lng;
      if (methodId === 'geo') {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          addPost(typeId, lat, lng, null);
        } catch (err) {
          tg.showAlert('Не удалось получить геолокацию. Разрешите доступ в настройках.');
        }
      } else {
        tg.showAlert('Тапните на карту для выбора точки');
        map.once('click', (e) => {
          lat = e.latlng.lat;
          lng = e.latlng.lng;
          handleDirection(typeId, lat, lng);
        });
      }
    });
  });
});

function handleDirection(type, lat, lng) {
  if (type === 'stationary') {
    addPost(type, lat, lng, null);
  } else {
    tg.showPopup({
      title: 'Направление движения',
      message: 'Куда ехал фургон?',
      buttons: [
        { type: 'default', id: 'N', text: 'Север' },
        { type: 'default', id: 'S', text: 'Юг' },
        { type: 'default', id: 'E', text: 'Восток' },
        { type: 'default', id: 'W', text: 'Запад' }
      ]
    }, (dir) => {
      if (dir) addPost(type, lat, lng, dir);
    });
  }
}

async function addPost(type, lat, lng, direction) {
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
    updatePosts();
    tg.HapticFeedback.success();
    tg.showAlert('Пост добавлен!');
  } catch (err) {
    tg.showAlert('Ошибка добавления: ' + err.message);
  }
}

window.deletePost = async (id) => {
  await deleteDoc(doc(db, "policePosts", id));
  updatePosts();
  tg.showAlert('Пост удалён');
};

// Кнопка "Моя позиция" (отслеживание + центрирование)
document.getElementById('location-btn').addEventListener('click', () => {
  if (watchId) {
    // Выключить
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (userMarker) map.removeLayer(userMarker);
    document.getElementById('location-btn').textContent = 'Моя позиция';
    return;
  }

  // Включить трекинг
  watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    if (!userMarker) {
      userMarker = L.marker([latitude, longitude], {
        icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [24, 24], iconAnchor: [12, 24] })
      }).addTo(map);
    } else {
      userMarker.setLatLng([latitude, longitude]);
    }
    // Только центрируем, без изменения зума
    map.panTo([latitude, longitude]);

    // Предупреждение о близости постов
    markers.forEach(m => {
      const dist = map.distance([latitude, longitude], m.getLatLng());
      if (dist < 500) {
        tg.HapticFeedback.notificationOccurred('warning');
        tg.showAlert(`ДПС рядом! ~${Math.round(dist)} м`);
      }
    });
  }, (err) => tg.showAlert('Геолокация недоступна: ' + err.message), { enableHighAccuracy: true });

  document.getElementById('location-btn').textContent = 'Остановить';
});

// Адаптация темы
if (tg.themeParams) {
  document.body.style.backgroundColor = tg.themeParams.bg_color || '#121212';
}