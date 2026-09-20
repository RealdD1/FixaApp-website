// booking.js

// 🚨 REMOVED: const socket = window.globalSocket;
// 🚨 REMOVED: waitForSocketReady() function. 
// The client no longer needs to wait for the socket to send the job.

const API_KEY = "092c5d59abdd4704b1a055ec21d8ff79";
const bookingData = JSON.parse(localStorage.getItem("bookingData"));
const user = JSON.parse(localStorage.getItem("user")); 

let userLocation = null; // Store detected location

// ✅ Show floating message (Ensuring it handles all messages now)
function showMessage(message, type = "info") {
    // ... (Your existing showMessage function remains the same) ...
    const existingMessage = document.getElementById("app-message");
    if (existingMessage) existingMessage.remove();

    const messageDiv = document.createElement("div");
    messageDiv.id = "app-message";
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        color: white;
        font-weight: bold;
        text-align: center;
        z-index: 9999;
        transition: all 0.5s ease;
        opacity: 0;
        visibility: hidden;
    `;
    messageDiv.style.backgroundColor =
        type === "success"
            ? "rgba(40, 167, 69, 0.9)"
            : type === "error"
            ? "rgba(220, 53, 69, 0.9)"
            : "rgba(255, 193, 7, 0.9)";
    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.style.opacity = "1";
        messageDiv.style.visibility = "visible";
    }, 10);
    setTimeout(() => {
        messageDiv.style.opacity = "0";
        messageDiv.style.visibility = "hidden";
        setTimeout(() => messageDiv.remove(), 500);
    }, 3000);
}


// ✅ Network listener
window.addEventListener("online", () => showMessage("✅ You are back online.", "success"));
window.addEventListener("offline", () => showMessage("❌ You are offline.", "error"));
if (!navigator.onLine) showMessage("❌ You are offline.", "error");

if (bookingData) {
    const { artisanName, category, difficulty, hours, estimatedRange } = bookingData;

    document.getElementById("artisanName").textContent = artisanName || "Unknown";
    document.getElementById("category").textContent = category || "N/A";
    document.getElementById("difficulty").textContent =
        { "1": "🟢 Easy", "1.5": "🟡 Medium", "2": "🔴 Hard", "3": "🔥 Very Hard" }[
            difficulty
        ] || "N/A";
    document.getElementById("hours").textContent = hours || "N/A";
    document.getElementById("minPrice").textContent = estimatedRange.minPrice.toLocaleString();
    document.getElementById("maxPrice").textContent = estimatedRange.maxPrice.toLocaleString();

    // ✅ Detect location automatically
    function getAddressFromGeolocation() {
        const addressInput = document.getElementById("address");
        const helpText = document.getElementById("addressHelpText");

        if (!navigator.onLine) {
            showMessage("⚠️ Offline. Cannot detect address automatically.", "info");
            return;
        }

        if (navigator.geolocation) {
            addressInput.disabled = true;
            addressInput.placeholder = "Detecting your location...";
            helpText.textContent = "Please wait while we find your address...";

            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const { latitude, longitude } = pos.coords;
                    // Ensure location is stored as [longitude, latitude] for MongoDB GeoJSON
                    userLocation = { type: "Point", coordinates: [longitude, latitude] }; 

                    const apiUrl = `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${API_KEY}`;
                    try {
                        const res = await fetch(apiUrl);
                        const data = await res.json();
                        const formatted =
                            data.features[0]?.properties?.formatted || "Address not found.";
                        addressInput.value = formatted;
                        helpText.textContent = "Address detected. You can edit it.";
                        showMessage("📍 Location detected successfully.", "success");
                    } catch (err) {
                        console.error(err);
                        helpText.textContent = "Failed to get address. Enter manually.";
                        showMessage("⚠️ Failed to get address. Enter manually.", "info");
                    } finally {
                        addressInput.disabled = false;
                        addressInput.placeholder = "Your street address, city, state";
                    }
                },
                (err) => {
                    console.warn("Geolocation error:", err.message);
                    addressInput.disabled = false;
                    helpText.textContent = "Location access denied. Enter manually.";
                    showMessage("⚠️ Location access denied. Enter manually.", "info");
                }
            );
        }
    }

    getAddressFromGeolocation();
} else {
    showMessage("❌ No booking data found. Redirecting...", "error");
    setTimeout(() => { window.location.href = "map.html"; }, 2000); 
}

// ✅ Booking submission
const form = document.getElementById("bookingForm");
const submitBtn = document.getElementById("submitBtn");
document.getElementById("date").min = new Date().toISOString().split("T")[0];

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const description = document.getElementById("description").value.trim();
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const address = document.getElementById("address").value.trim();

    if (!navigator.onLine) return showMessage("⚠️ You are offline.", "info");
    if (!description || !date || !time || !address || !userLocation)
        return showMessage("⚠️ Please fill all fields and wait for location detection.", "info");

    const token = localStorage.getItem("token");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `Booking... <div class="spinner"></div>`;

    try {
        // 1. Send Booking data to the API
        const res = await fetch("http://localhost:5000/api/bookings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                // Pass all necessary data for the controller to process and notify
                artisanId: bookingData.artisanId, 
                estimatedPrice: bookingData.estimatedPrice,
                category: bookingData.category,
                description,
                date,
                time,
                address,
                location: userLocation,
                // Include customer info if the backend doesn't resolve it from the token
                customerName: user.username || "A Customer", 
                customerId: user._id, 
            }),
        });

        const data = await res.json();
        if (res.ok) {
            const newBookingId = data.booking?.bookingId || data.bookingId;
const newBookingObjectId = data.booking?._id || data.bookingObjectId;
const chatId = data.chatId || data.booking?.chatId;

console.log('Booking _id:', newBookingObjectId, 'Display ID:', newBookingId, 'Chat:', chatId);

// Save for the receipt page (human-readable ID for display)
localStorage.setItem("lastBooking", JSON.stringify({
  artisanName: bookingData.artisanName,
  bookingId: newBookingId,            // FIXA-XXXXX for the receipt
  bookingObjectId: newBookingObjectId, // _id in case the receipt page needs to fetch
  chatId,
  category: bookingData.category,
  description,
  date,
  time,
  address,
  estimatedPrice: bookingData.estimatedPrice,
}));

showMessage("✅ Booking confirmed! Artisan has been notified.", "success");

// Single decision — go to chat if we have one, else receipt
if (chatId) {
  localStorage.setItem("openChatWith", JSON.stringify({
    chatId,
    name: bookingData.artisanName
  }));
  setTimeout(() => {
    window.location.href = "customer-home.html?openMessages=true";
  }, 1800);
} else {
  setTimeout(() => {
    window.location.href = "booking-receipt.html";
  }, 1800);
}

        } else {
            if (res.status === 401) {
                showMessage("❌ Session expired. Please log in again.", "error");
                setTimeout(() => (window.location.href = "SignIn.html"), 2000);
            } else {
                showMessage("❌ " + (data.message || "Booking failed."), "error");
            }
        }
    } catch (err) {
        console.error(err);
        showMessage("⚠️ Network error. Try again.", "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Submit Booking`;
    }
});