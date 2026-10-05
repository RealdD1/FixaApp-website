  .setEndpoint('https://cloud.appwrite.io/v1') // ✅ Don't change this
  .setProject('687af6e5003e64d63758');        
function isValidEmail(input) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(input);
}

function isValidPhone(input) {
  const phonePattern = /^[0-9]{8,15}$/;
  return phonePattern.test(input);
}

document.getElementById('signupForm').addEventListener('submit', function(e) {
  e.preventDefault();

  const emailPhone = document.getElementById("emailPhone").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmpassword = document.getElementById("confirmPassword").value.trim();

  const message1 = document.getElementById("message1");
  const message2 = document.getElementById("message2");
  const message3 = document.getElementById("message3");

  message1.innerHTML = "";
  message2.innerHTML = "";
  message3.innerHTML = "";

  let valid = true;

  // Validate email or phone
  if (emailPhone === "") {
    message1.innerHTML = "Enter email or phone";
    valid = false;
  } else if (!isValidEmail(emailPhone)) {
    message1.innerHTML = "Enter a valid email";
    valid = false;
  }

  // Validate password
  if (password === "") {
    message2.innerHTML = "Enter your password";
    valid = false;
  } else if (password.length < 6) {
    message2.innerHTML = "Password should not be less than 6 characters";
    valid = false;
  } else if (password.length > 12) {
    message2.innerHTML = "Password should not be more than 12 characters";
    valid = false;
  }

  if (confirmpassword === "") {
    message3.innerHTML = "Reconfirm password";
    valid = false;
  } else if (confirmpassword !== password) {
    message3.innerHTML = "Passwords do not match";
    valid = false;
  }

  if (!valid) return;

  // Create Appwrite user
  account.create(
    Appwrite.ID.unique(),
    emailPhone,
    password
  ).then(response => {
    alert("Signup successful! Now you can sign in.");
    window.location.href = "SignIn.html";
  }).catch(error => {
    alert("Signup failed: " + error.message);
    console.error(error);
  });
});
    // Show loader
    document.getElementById('loader').style.display = 'flex';

    setTimeout(() => {
      window.location.href = 'selection.html';
    }, 1500);

  } catch (error) {
    alert("Login failed: " + error.message);
  }
});