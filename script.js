// Initialize Appwrite client
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);

// Set Appwrite Cloud endpoint and your actual project ID
client
  .setEndpoint('https://cloud.appwrite.io/v1') // ✅ Don't change this
  .setProject('p');         // 🔁 Your actual project ID

// Email validation helper
function isValidEmail(input) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(input);
}

// Handle form submission
document.getElementById('signupForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const emailPhone = document.getElementById("emailPhone").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();

  const message1 = document.getElementById("message1");
  const message2 = document.getElementById("message2");
  const message3 = document.getElementById("message3");

  // Reset error messages
  message1.innerHTML = "";
  message2.innerHTML = "";
  message3.innerHTML = "";

  let valid = true;

  // Validate email/phone input
  if (emailPhone === "") {
    message1.innerHTML = "Please enter your email.";
    valid = false;
  } else if (!isValidEmail(emailPhone)) {
    message1.innerHTML = "Enter a valid email.";
    valid = false;
  }

  // Validate password
  if (password === "") {
    message2.innerHTML = "Enter a password.";
    valid = false;
  } else if (password.length < 6) {
    message2.innerHTML = "Password must be at least 6 characters.";
    valid = false;
  }

  // Confirm password
  if (confirmPassword === "") {
    message3.innerHTML = "Please confirm your password.";
    valid = false;
  } else if (password !== confirmPassword) {
    message3.innerHTML = "Passwords do not match.";
    valid = false;
  }

  if (!valid) return;

  // Create new user in Appwrite
  account.create(Appwrite.ID.unique(), emailPhone, password)
    .then(response => {
      alert("Signup successful!");
      window.location.href = "signin.html"; // ✅ Redirect to sign-in page
    })
    .catch(error => {
      alert("Signup failed: " + error.message);
      console.error("Appwrite error:", error);
    });
});