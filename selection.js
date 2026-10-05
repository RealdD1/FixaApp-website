
document.getElementById('artisanBtn').addEventListener('click', function() {
  // Show loader
  document.getElementById('loader').style.display = 'flex';

  // Optional: disable buttons to prevent double click
  document.querySelectorAll('.role-btn').forEach(btn => btn.disabled = true);

  // Simulate loading → then redirect
  setTimeout(() => {
    window.location.href = 'artisan-home.html';
  }, 2000);
});

document.getElementById('professionalBtn').addEventListener('click', function() {
  document.getElementById('loader').style.display = 'flex';
  document.querySelectorAll('.role-btn').forEach(btn => btn.disabled = true);

  setTimeout(() => {
    window.location.href = 'customer-home.html';
  }, 2000);
});