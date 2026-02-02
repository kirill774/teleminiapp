// Импорт необходимых модулей / Import required modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

// Конфигурация Firebase / Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBClJ_q3_sCZaXiVap2NlXXyXef8xz1Crk",
  authDomain: "mupolic.firebaseapp.com",
  projectId: "mupolic",
  storageBucket: "mupolic.firebasestorage.app",
  messagingSenderId: "222195384073",
  appId: "1:222195384073:web:0bcafbd16d9b59c7eb9dd8",
  measurementId: "G-EG8N9J8TMW"
};

// Инициализация Firebase / Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Анонимная аутентификация / Anonymous authentication
signInAnonymously(auth).then(() => {
  console.log("Аутентификация успешна / Auth successful");
}).catch(err => console.error("Ошибка аутентификации / Auth error:", err));

// Инициализация карты Leaflet / Initialize Leaflet map
const map = L.map('map').setView([10.933, 108.283], 13); // Центр на Муйне / Center on Mui Ne
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
}).addTo(map);

// Переменные для отслеживания позиции пользователя / User position tracking variables
let userMarker = null;
let tracking = false;
let myLatLng = null;
let isAdding = false;

// Заглушка для Telegram.WebApp для тестирования в браузере / Stub for Telegram.WebApp in browser
let tg = window.Telegram ? window.Telegram.WebApp : null;
if (!tg) {
  console.warn("Telegram.WebApp не найден, использую заглушку / Telegram.WebApp not found, using stub");
  tg = {
    showAlert: (msg) => alert(msg),
    showPopup: (options, callback) => {
      let btnTexts = options.buttons.map(b => b.text).join('\n');
      let res = prompt(options.title + '\nВыберите: ' + btnTexts);
      let btn = options.buttons.find(b => b.text.toLowerCase() === (res || '').toLowerCase());
      callback(btn ? btn.id : null);
    },
    ready: () => console.log("Stub ready")
  };
}

// Инициализация Telegram WebApp / Initialize Telegram WebApp
tg.ready();

// Инициализация геолокации при запуске / Initialize geolocation on start
navigator.geolocation.getCurrentPosition(pos => {
  myLatLng = [pos.coords.latitude, pos.coords.longitude];
  console.log("Начальная позиция получена / Initial position received:", myLatLng);
}, err => {
  console.error("Ошибка начальной геолокации / Initial geolocation error:", err);
  tg.showAlert("Разрешите геолокацию для работы приложения / Allow geolocation for the app");
}, { enableHighAccuracy: true, timeout: 10000 });

// Отслеживание геолокации пользователя / Watch user geolocation
navigator.geolocation.watchPosition(pos => {
  myLatLng = [pos.coords.latitude, pos.coords.longitude];
  console.log("Позиция обновлена / Position updated:", myLatLng);
  if (tracking && userMarker) {
    userMarker.setLatLng(myLatLng);
    map.panTo(myLatLng);
  }
}, err => console.error("Ошибка геолокации / Geolocation error:", err), { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 });

// Функция добавления поста / Function to add a post
const addPost = async (lat, lng, type, color, direction = null) => {
  if (!auth.currentUser) {
    tg.showAlert("Аутентификация не завершена, попробуйте позже / Auth not ready, try later");
    return;
  }

  // Антиспам: проверка на кулдаун 1 минута / Anti-spam: check 1-minute cooldown
  const lastAddTime = localStorage.getItem('lastAddTime');
  if (lastAddTime && Date.now() - parseInt(lastAddTime) < 60000) {
    tg.showAlert("Подождите 1 минуту перед добавлением нового поста / Wait 1 minute before adding a new post");
    return;
  }

  if (isAdding) return;
  isAdding = true;
  try {
    await addDoc(collection(db, "policePosts"), {
      lat,
      lng,
      type,
      color,
      direction,
      timestamp: serverTimestamp(),
      userId: auth.currentUser.uid
    });
    localStorage.setItem('lastAddTime', Date.now());
    tg.showAlert("Пост добавлен! / Post added!");
  } catch (e) {
    tg.showAlert("Ошибка: " + e.message);
    console.error("Ошибка добавления / Add error:", e);
  } finally {
    isAdding = false;
  }
};

// Функция удаления поста / Function to delete a post
const deletePost = async (id) => {
  try {
    await deleteDoc(doc(db, "policePosts", id));
    tg.showAlert("Пост удалён / Post deleted");
  } catch (e) {
    tg.showAlert("Ошибка удаления / Delete error: " + e.message);
    console.error("Ошибка удаления / Delete error:", e);
  }
};

// Функция обновления постов на карте / Function to update posts on the map
const updatePosts = () => {
  onSnapshot(collection(db, "policePosts"), (snapshot) => {
    // Удаляем старые слои постов / Remove old post layers
    map.eachLayer(layer => {
      if (layer.options && layer.options.isPost) map.removeLayer(layer);
    });

    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.timestamp) return;
      const age = (Date.now() - data.timestamp.toMillis()) / 1000;  // Возраст в секундах / Age in seconds
      if (age > 1800) return;  // Удаляем если старше 30 минут (1800 сек) / Skip if older than 30 minutes

      const remaining = Math.max(0, 30 - age / 60);  // Оставшееся время в минутах / Remaining time in minutes

      // Выбор иконки на основе типа и цвета / Select icon based on type and color
      let iconSrc = '';
      if (data.type === 'stationary') {
        iconSrc = data.color === 'darkgreen' ? 'stationary_darkgreen.svg' : 'stationary_sandy.svg';
      } else if (data.type === 'moving') {
        iconSrc = data.color === 'darkgreen' ? 'moving_darkgreen.svg' : 'moving_sandy.svg';
      }

      const iconHtml = `<div class="timer">${Math.ceil(remaining)} мин</div><img src="${iconSrc}" width="40">`;
      const icon = L.divIcon({ html: iconHtml, className: "", iconSize: [40, 40] });

      const marker = L.marker([data.lat, data.lng], { icon, isPost: true }).addTo(map);

      // Попап с деталями / Popup with details
      let popupContent = `
        <b>${data.type === 'stationary' ? 'Стоячий пост' : 'Движущийся фургон'}</b><br>
        Время: ${Math.ceil(remaining)} мин<br>
      `;
      if (data.direction) popupContent += `Направление: ${data.direction}<br>`;
      if (data.userId === auth.currentUser.uid) {
        popupContent += `<button class="btn-delete" onclick="window.deletePost('${docSnap.id}')">Удалить</button>`;
      }
      marker.bindPopup(popupContent);
    });
  }, err => console.error("Ошибка snapshot / Snapshot error:", err));
};

// Обработчик кнопки "Добавить" / Add button handler
document.getElementById("addBtn").addEventListener("click", () => {
  console.log("Кнопка 'Добавить' нажата / Add button clicked");
  if (isAdding) return;

  // Выбор типа поста / Choose post type
  tg.showPopup({
    title: "Выберите тип поста",
    buttons: [
      { id: "stationary", text: "Стоячий пост" },
      { id: "moving", text: "Движущийся фургон" }
    ]
  }, (typeRes) => {
    if (!typeRes) return;
    const type = typeRes;

    // Выбор цвета иконки / Choose icon color
    tg.showPopup({
      title: "Выберите цвет иконки",
      buttons: [
        { id: "darkgreen", text: "Чуть тёмный зелёный" },
        { id: "sandy", text: "Песочный" }
      ]
    }, (colorRes) => {
      if (!colorRes) return;
      const color = colorRes;

      // Если движущийся — выбор направления (опционально) / If moving — choose direction (optional)
      let direction = null;
      if (type === 'moving') {
        tg.showPopup({
          title: "Выберите направление (опционально)",
          buttons: [
            { id: "north", text: "Север" },
            { id: "south", text: "Юг" },
            { id: "east", text: "Восток" },
            { id: "west", text: "Запад" },
            { id: "none", text: "Без направления" }
          ]
        }, (dirRes) => {
          if (dirRes && dirRes !== "none") direction = dirRes;

          // Выбор способа добавления / Choose add method
          proceedToAdd(type, color, direction);
        });
      } else {
        proceedToAdd(type, color, direction);
      }
    });
  });
});

// Вспомогательная функция для выбора способа добавления / Helper function for add method
const proceedToAdd = (type, color, direction) => {
  tg.showPopup({
    title: "Способ добавления",
    buttons: [
      { id: "geo", text: "По геолокации" },
      { id: "tap", text: "Тапнуть на карте" }
    ]
  }, async (addRes) => {
    if (!addRes) return;
    if (addRes === "geo") {
      if (!myLatLng) {
        tg.showAlert("Геолокация недоступна, попробуйте позже / Geolocation unavailable, try later");
        return;
      }
      await addPost(myLatLng[0], myLatLng[1], type, color, direction);
    } else if (addRes === "tap") {
      tg.showAlert("Тапните на карту / Tap on the map");
      map.once('click', async (e) => {
        await addPost(e.latlng.lat, e.latlng.lng, type, color, direction);
      });
    }
  });
};

// Обработчик кнопки "Моя позиция" / My position button handler
document.getElementById("myPosBtn").addEventListener("click", () => {
  console.log("Кнопка 'Моя позиция' нажата / My position button clicked");
  if (!myLatLng) {
    tg.showAlert("Позиция не определена. Разрешите геолокацию и подождите / Position not determined. Allow geolocation and wait");
    return;
  }
  if (!tracking) {
    tracking = true;
    userMarker = L.marker(myLatLng, { icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [30, 30] }) }).addTo(map);
    map.flyTo(myLatLng, 15, { duration: 1.5 });
    tg.showAlert("Отслеживание включено / Tracking enabled");
  } else {
    tracking = false;
    if (userMarker) map.removeLayer(userMarker);
    tg.showAlert("Отслеживание выключено / Tracking disabled");
  }
});

// Запуск обновления постов / Start updating posts
updatePosts();

// Глобальный deletePost для попапа / Global deletePost for popup
window.deletePost = deletePost;