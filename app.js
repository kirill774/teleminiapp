// Импорт необходимых модулей / Import required modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import L from "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

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
signInAnonymously(auth).catch(err => console.error("Ошибка аутентификации / Auth error:", err));

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

// Отслеживание геолокации пользователя / Watch user geolocation
navigator.geolocation.watchPosition(pos => {
  myLatLng = [pos.coords.latitude, pos.coords.longitude];
  if (tracking && userMarker) {
    userMarker.setLatLng(myLatLng);
    map.panTo(myLatLng);
  }
}, err => console.error("Ошибка геолокации / Geolocation error:", err), { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });

// Функция добавления поста / Function to add a post
const addPost = async (lat, lng, type, color, direction = null) => {
  // Антиспам: проверка на кулдаун 1 минута / Anti-spam: check 1-minute cooldown
  const lastAddTime = localStorage.getItem('lastAddTime');
  if (lastAddTime && Date.now() - parseInt(lastAddTime) < 60000) {
    Telegram.WebApp.showAlert("Подождите 1 минуту перед добавлением нового поста / Wait 1 minute before adding a new post");
    return;
  }

  if (isAdding) return;
  isAdding = true;
  try {
    await addDoc(collection(db, "policePosts"), {
      lat,
      lng,
      type,
      color,  // Новый поле: цвет иконки / New field: icon color
      direction,
      timestamp: serverTimestamp(),
      userId: auth.currentUser.uid
    });
    localStorage.setItem('lastAddTime', Date.now());
    Telegram.WebApp.showAlert("Пост добавлен! / Post added!");
  } catch (e) {
    Telegram.WebApp.showAlert("Ошибка: " + e.message);
  } finally {
    isAdding = false;
  }
};

// Функция удаления поста / Function to delete a post
const deletePost = async (id) => {
  try {
    await deleteDoc(doc(db, "policePosts", id));
    Telegram.WebApp.showAlert("Пост удалён / Post deleted");
  } catch (e) {
    Telegram.WebApp.showAlert("Ошибка удаления / Delete error: " + e.message);
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
        popupContent += `<button class="btn-delete" onclick="deletePost('${docSnap.id}')">Удалить</button>`;
      }
      marker.bindPopup(popupContent);
    });
  });
};

// Инициализация Telegram WebApp / Initialize Telegram WebApp
Telegram.WebApp.ready();

// Обработчик кнопки "Добавить" / Add button handler
document.getElementById("addBtn").addEventListener("click", () => {
  if (isAdding) return;

  // Выбор типа поста / Choose post type
  Telegram.WebApp.showPopup({
    title: "Выберите тип поста",
    buttons: [
      { id: "stationary", text: "Стоячий пост" },
      { id: "moving", text: "Движущийся фургон" }
    ]
  }, (typeRes) => {
    if (!typeRes) return;
    const type = typeRes.id;

    // Выбор цвета иконки / Choose icon color
    Telegram.WebApp.showPopup({
      title: "Выберите цвет иконки",
      buttons: [
        { id: "darkgreen", text: "Чуть тёмный зелёный" },
        { id: "sandy", text: "Песочный" }
      ]
    }, (colorRes) => {
      if (!colorRes) return;
      const color = colorRes.id;

      // Если движущийся — выбор направления (опционально) / If moving — choose direction (optional)
      let direction = null;
      if (type === 'moving') {
        Telegram.WebApp.showPopup({
          title: "Выберите направление (опционально)",
          buttons: [
            { id: "north", text: "Север" },
            { id: "south", text: "Юг" },
            { id: "east", text: "Восток" },
            { id: "west", text: "Запад" },
            { id: "none", text: "Без направления" }
          ]
        }, (dirRes) => {
          if (dirRes && dirRes.id !== "none") direction = dirRes.text;

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
  Telegram.WebApp.showPopup({
    title: "Способ добавления",
    buttons: [
      { id: "geo", text: "По геолокации" },
      { id: "tap", text: "Тапнуть на карте" }
    ]
  }, async (addRes) => {
    if (!addRes) return;
    if (addRes.id === "geo") {
      navigator.geolocation.getCurrentPosition(pos => {
        addPost(pos.coords.latitude, pos.coords.longitude, type, color, direction);
      }, err => Telegram.WebApp.showAlert("Геолокация недоступна / Geolocation unavailable"));
    } else if (addRes.id === "tap") {
      Telegram.WebApp.showAlert("Тапните на карту / Tap on the map");
      map.once('click', async (e) => {
        await addPost(e.latlng.lat, e.latlng.lng, type, color, direction);
      });
    }
  });
};

// Обработчик кнопки "Моя позиция" / My position button handler
document.getElementById("myPosBtn").addEventListener("click", () => {
  if (!myLatLng) {
    Telegram.WebApp.showAlert("Позиция не определена / Position not determined");
    return;
  }
  if (!tracking) {
    tracking = true;
    userMarker = L.marker(myLatLng, { icon: L.icon({ iconUrl: 'user-icon.svg', iconSize: [30, 30] }) }).addTo(map);
    map.flyTo(myLatLng, 15, { duration: 1.5 });
    Telegram.WebApp.showAlert("Отслеживание включено / Tracking enabled");
  } else {
    tracking = false;
    if (userMarker) map.removeLayer(userMarker);
    Telegram.WebApp.showAlert("Отслеживание выключено / Tracking disabled");
  }
});

// Запуск обновления постов / Start updating posts
updatePosts();