import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Твой Firebase config (вставлен)
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

// Аутентификация (анонимная)
signInAnonymously(auth)
  .then(() => console.log("Authenticated"))
  .catch((error) => console.error("Auth error:", error));

// Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Карта (центр на Муйне, Вьетнам)
const map = L.map('map', { zoomControl: true }).setView([10.933, 108.283], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" style="color:#fff;">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" style="color:#fff;">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

// Массивы
let markers = [];
let userMarker;
let watchId;
const STATIONARY_AGE = 30 * 60 * 1000; // 30 мин
const MOVING_AGE = 5 * 60 * 1000; // 5 мин
const UPDATE_INTERVAL = 10000; // 10 сек

// Антиспам: Последнее время добавления (client-side)
const LAST_ADD_KEY = 'lastAddTime';
function canAddPost() {
  const lastAdd = parseInt(localStorage.getItem(LAST_ADD_KEY) || '0');
  const now = Date.now();
  if (now - lastAdd < 60000) { // 1 минута cooldown
    tg.showAlert('Подождите минуту перед добавлением нового.');
    return false;
  }
  return true;
}
function recordAdd() {
  localStorage.setItem(LAST_ADD_KEY, Date.now().toString());
}

// Функция обновления постов
async function updatePosts() {
  // Очистка старых маркеров плавно
  markers.forEach(m => {
    m._icon.classList.remove('marker-visible');
    m._icon.classList.add('marker-fade');
    setTimeout(() => map.removeLayer(m), 1000); // Синхронизировано с transition 1s
  });
  markers = [];

  const now = Date.now();
  const q = query(postsCollection, where("timestamp", ">", now - Math.max(STATIONARY_AGE, MOVING_AGE)));
  const snapshot = await getDocs(q);
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const age = now - data.timestamp.seconds * 1000; // Поскольку serverTimestamp возвращает объект
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

    const marker = L.marker([data.lat, data.lng], { icon: customIcon })
      .addTo(map)
      .bindPopup(`Пост ДПС${direction} (добавлен ${new Date(data.timestamp.seconds * 1000).toLocaleTimeString()})<br><button onclick="deletePost('${docSnap.id}')">Удалить</button>`);
    
    // Плавное появление
    setTimeout(() => {
      marker._icon.classList.remove('marker-fade');
      marker._icon.classList.add('marker-visible');
    }, 100);

    markers.push(marker);
  });
}
setInterval(updatePosts, UPDATE_INTERVAL);
updatePosts();

// Добавление
document.getElementById('add-btn').addEventListener('click', () => {
  if (!canAddPost()) return;

  tg.showPopup({
    title: 'Добавить',
    message: 'Выберите тип',
    buttons: [
      { id: 'stationary', text: 'Стоячий пост' },
      { id: 'moving', text: 'Движущийся фургон' }
    ]
  }, (typeId) => {
    const type = typeId;
    tg.showPopup({
      title: 'Способ добавления',
      message: 'Выберите способ',
      buttons: [
        { id: 'geo', text: 'По геолокации' },
        { id: 'manual', text: 'Вручную' }
      ]
    }, async (methodId) => {
      let lat, lng;
      try {
        if (methodId === 'geo') {
          const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true }));
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } else {
          map.once('click', (e) => {
            lat = e.latlng.lat;
            lng = e.latlng.lng;
            handleDirectionAndAdd(type, lat, lng);
          });
          tg.showAlert('Тапните на карту');
          return;
        }
        handleDirectionAndAdd(type, lat, lng);
      } catch (err) {
        tg.showAlert('Ошибка геолокации: ' + err.message);
      }
    });
  });
});

function handleDirectionAndAdd(type, lat, lng) {
  if (type === 'stationary') {
    addPost(type, lat, lng, null);
  } else {
    tg.showPopup({
      title: 'Направление',
      message: 'Выберите сторону',
      buttons: [
        { id: 'N', text: 'Север' },
        { id: 'S', text: 'Юг' },
        { id: 'E', text: 'Восток' },
        { id: 'W', text: 'Запад' }
      ]
    }, (dirId) => {
      addPost(type, lat, lng, dirId);
    });
  }
}

async function addPost(type, lat, lng, direction) {
  await addDoc(postsCollection, {
    type,
    lat,
    lng,
    direction,
    timestamp: serverTimestamp(), // Исправлено на serverTimestamp для точности
    userId: tg.initDataUnsafe?.user?.id || 'anonymous'
  });
  recordAdd();
  updatePosts();
  tg.HapticFeedback.impactOccurred('light');
}

// Удаление поста
window.deletePost = async (id) => {
  try {
    await deleteDoc(doc(db, "policePosts", id));
    updatePosts();
    tg.showAlert('Удалено');
  } catch (err) {
    tg.showAlert('Ошибка: ' + err.message);
  }
};

// Кнопка "Где я"
document.getElementById('where-am-i-btn').addEventListener('click', async () => {
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true }));
    const { latitude, longitude } = pos.coords;
    map.flyTo([latitude, longitude], 15, { animate: true, duration: 1.5 }); // Увеличил до 1.5s
    if (!userMarker) {
      userMarker = L.marker([latitude, longitude], {
        icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24] })
      }).addTo(map).bindPopup('Ваша позиция');
    } else {
      userMarker.setLatLng([latitude, longitude]);
    }
    setTimeout(() => {
      if (userMarker && !watchId) {
        map.removeLayer(userMarker);
        userMarker = null;
      }
    }, 10000);
  } catch (err) {
    tg.showAlert('Ошибка геолокации: ' + err.message);
  }
});

// Отслеживание геолокации
document.getElementById('track-btn').addEventListener('click', () => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    document.getElementById('track-btn').textContent = 'Отслеживать';
    return;
  }

  watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    if (!userMarker) {
      userMarker = L.marker([latitude, longitude], {
        icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24] })
      }).addTo(map).bindPopup('Ваша позиция');
    } else {
      userMarker.setLatLng([latitude, longitude]);
    }
    map.flyTo([latitude, longitude], 15, { animate: true, duration: 1.0 }); // Увеличил до 1s

    // Проверка близости
    markers.forEach(m => {
      const dist = map.distance(userMarker.getLatLng(), m.getLatLng());
      if (dist < 500) {
        tg.HapticFeedback.notificationOccurred('warning');
        tg.showAlert(`Внимание! ДПС в ${Math.round(dist)} метрах!`);
      }
    });
  }, (err) => {
    tg.showAlert('Ошибка геолокации: ' + err.message);
  }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });

  document.getElementById('track-btn').textContent = 'Остановить';
});

// Адаптация под тему Telegram
if (tg.themeParams) {
  document.body.style.backgroundColor = tg.themeParams.bg_color || '#121212';
  document.querySelector('.bottom-bar').style.backgroundColor = tg.themeParams.secondary_bg_color || '#1c1c1c';
  const buttons = document.querySelectorAll('.button');
  buttons.forEach(btn => {
    btn.style.backgroundColor = tg.themeParams.button_color || '#1E88E5';
    btn.style.color = tg.themeParams.button_text_color || '#fff';
  });
}