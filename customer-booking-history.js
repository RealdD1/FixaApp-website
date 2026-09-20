document.addEventListener("DOMContentLoaded", () => {
    // Check if the user is authenticated
    const token = localStorage.getItem("token");
    if (!token) {
        // Redirect to the sign-in page if no token is found
        window.location.href = "SignIn.html";
        return;
    }

    // Call the function to fetch and display bookings
    fetchAndDisplayBookings(token);
});

async function fetchAndDisplayBookings(token) {
    try {
        const response = await fetch("http://localhost:5000/api/users/bookings", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Handle unauthorized access (token expired or invalid)
                alert("Session expired. Please sign in again.");
                localStorage.clear();
                window.location.href = "SignIn.html";
                return;
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const bookings = await response.json();
        
        // Sort and render the bookings
        renderBookings(bookings);

    } catch (error) {
        console.error("Error fetching booking history:", error);
        document.querySelector('.container').innerHTML = `
            <h2>My Bookings</h2>
            <div class="empty-state">
                <p>Failed to load booking history. Please try again later.</p>
            </div>
        `;
    }
}

function renderBookings(bookings) {
    const pendingList = document.getElementById("pending-list");
    const acceptedList = document.getElementById("accepted-list");
    const rejectedList = document.getElementById("rejected-list");
    const completedList = document.getElementById("completed-list");

    // Clear existing content to prevent duplicates on re-render
    pendingList.innerHTML = '';
    acceptedList.innerHTML = '';
    rejectedList.innerHTML = '';
    completedList.innerHTML = '';

    if (bookings.length === 0) {
        // Display an empty state message if there are no bookings
        document.querySelector('.container').innerHTML = `
            <h2>My Bookings</h2>
            <div class="empty-state">
                <p>You have no booking history yet. Start by booking a service!</p>
            </div>
        `;
        return;
    }

    // Separate bookings by status and render them
    let hasPending = false;
    let hasAccepted = false;
    let hasRejected = false;
    let hasCompleted = false;

    bookings.forEach(booking => {
        const card = createBookingCard(booking);
        
        switch (booking.status.toLowerCase()) {
            case "pending":
                pendingList.appendChild(card);
                hasPending = true;
                break;
            case "accepted":
                acceptedList.appendChild(card);
                hasAccepted = true;
                break;
            case "rejected":
                rejectedList.appendChild(card);
                hasRejected = true;
                break;
                   case "verifying": // ✅ NEW
                acceptedList.appendChild(card);
                hasAccepted = true;
                break;

            case "completed":
                completedList.appendChild(card);
                hasCompleted = true;
                break;
        }
    });

    // Display a message if a section is empty
    if (!hasPending) pendingList.innerHTML = '<div class="empty-state"><p>No pending bookings.</p></div>';
    if (!hasAccepted) acceptedList.innerHTML = '<div class="empty-state"><p>No accepted bookings.</p></div>';
    if (!hasRejected) rejectedList.innerHTML = '<div class="empty-state"><p>No rejected bookings.</p></div>';
    if (!hasCompleted) completedList.innerHTML = '<div class="empty-state"><p>No completed bookings.</p></div>';
}

function createBookingCard(booking) {
    const card = document.createElement("div");
    card.classList.add("booking-card", booking.status.toLowerCase());

    const bookingDate = new Date(booking.date).toLocaleDateString();

    let actionButton = "";

    // 🟡 VERIFYING → show confirm button
    if (booking.status.toLowerCase() === "verifying") {
        actionButton = `
            <button class="btn-confirm" onclick="confirmCompletion('${booking._id}')">
                Confirm Completion
            </button>
        `;
    }

    // ✅ COMPLETED → show completed badge
    else if (booking.status.toLowerCase() === "completed") {
        actionButton = `<span class="badge completed">Completed ✅</span>`;
    }

    card.innerHTML = `
        <p><strong>Artisan:</strong> ${booking.artisanName}</p>
        <p><strong>Service:</strong> ${booking.category}</p>
        <p><strong>Date:</strong> ${bookingDate}</p>
        <p><strong>Time:</strong> ${booking.time}</p>
        <p><strong>Status:</strong> ${booking.status}</p>

        <div style="margin-top:10px;">
            ${actionButton}
        </div>
    `;

    return card;
}