const form = document.getElementById('signup-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const usernameStatus = document.getElementById('username-status');
const submitBtn = document.getElementById('submit-btn');

// --- Live Username Checker ---
let timeout = null;
usernameInput.addEventListener('keyup', () => {
    clearTimeout(timeout);
    usernameStatus.textContent = ''; // Clear previous message
    usernameStatus.className = '';
    
    timeout = setTimeout(async () => {
        const username = usernameInput.value;
        if (username.length > 3) {
            // Assume your backend has an endpoint to check username availability
            // You will need to create this endpoint in your backend
            // For now, this is a placeholder
            // In a real app, this would be an API call to a route like:
            // /api/users/check-username?username=yourusername
            const isAvailable = await checkUsernameAvailability(username);

            if (isAvailable) {
                usernameStatus.textContent = 'Username is available!';
                usernameStatus.classList.add('available');
            } else {
                usernameStatus.textContent = 'Username is already taken.';
                usernameStatus.classList.add('not-available');
            }
        }
    }, 500); // Wait 500ms after the user stops typing
});

// ...other frontend code

async function checkUsernameAvailability(username) {
    try {
        const response = await fetch(`http://localhost:5000/api/check-username?username=${username}`);
        const data = await response.json();
        return data.isAvailable;
    } catch (error) {
        console.error('Error checking username availability:', error);
        return false; // Assume not available on error
    }
}

// ...the rest of your frontend code

// --- Form Submission ---
form.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent default form submission

    if (passwordInput.value !== confirmPasswordInput.value) {
        alert("Passwords do not match!");
        return;
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // You will need to adjust the keys to match your backend's expected payload
    const payload = {
        email: data.emailOrPhone, // Assuming the backend can handle this
        username: data.username,
        password: data.password
    };

    try {
      const response = await fetch('http://localhost:5000/api/register', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            alert('Sign up successful!');
            console.log(result);
            // Redirect or update UI
        } else {
            alert(`Sign up failed: ${result.message}`);
            console.error('Error:', result);
        }
    } catch (error) {
        alert('An error occurred. Please try again.');
        console.error('Fetch error:', error);
    }
});