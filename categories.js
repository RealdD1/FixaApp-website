const categories = [
  {name:"Electrician",icon:"lightbulb"},
  { name: "Painter", icon: "format_paint" },
  { name: "Tiler", icon: "grid_on" },
  { name: "Mechanic", icon: "build" },
  { name: "Welder", icon: "construction" },
  { name: "Generator Repairer", icon: "power" },
  { name: "POP Installer", icon: "roofing" },
  { name: "Fashion Designer", icon: "checkroom" },
  { name: "Make-Up Artist", icon: "face_retouching_natural" },
  { name: "CCTV Installer", icon: "videocam" },
  { name: "Solar Panel Installer", icon: "solar_power" },
  { name: "Cook/Caterer", icon: "restaurant" },
  { name: "Handyman", icon: "handyman" },
  { name: "Carpenter", icon: "chair" },
  { name: "HVAC Technician", icon: "ac_unit" },
  { name: "Mobile Mechanic", icon: "directions_car" },
  { name: "Gardener", icon: "yard" },
  { name: "Roof Repair Specialist", icon: "roofing" },
  { name: "Tech Support", icon: "support" },
  { name: "Appliance Repairer", icon: "settings" },
  { name: "Interior Designer", icon: "home" },
  { name: "Window Installer", icon: "window" },
  { name: "Furniture Assembler", icon: "weekend" },
{ name: "Nanny/House help", icon: "child_friendly" },
  { name: "Massage Therapist", icon: "spa" }
];

const categoryList = document.getElementById('categoryList');
const searchInput = document.getElementById('searchInput');

// Render the categories
function renderCategories(filter = '') {
  categoryList.innerHTML = '';
  const filtered = categories.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));

  filtered.forEach(category => {
    const item = document.createElement('div');
    item.classList.add('category-item');

    item.innerHTML = `
      <label>
        <span class="material-icons">${category.icon}</span>
        ${category.name}
        <input type="radio" name="artisan" value="${category.name}">
      </label>
    `;

    categoryList.appendChild(item);
  });
}

// Initial render
renderCategories();

// Filter on search
searchInput.addEventListener('input', (e) => {
  renderCategories(e.target.value);
});

  const nextBtn = document.getElementById('nextBtn');

  nextBtn.addEventListener('click', () => {
    const selected = document.querySelector('input[name="artisan"]:checked');

    if (!selected) {
      alert("Please select a category before proceeding.");
      return;
    }

    const selectedCategory = selected.value;
    localStorage.setItem('selectedCategory', selectedCategory);

    // Store in history too (optional)
    let history = JSON.parse(localStorage.getItem('categoryHistory')) || [];
    history.push(selectedCategory);
    localStorage.setItem('categoryHistory', JSON.stringify(history));

    // Redirect to map page
    


document.getElementById('loader').style.display = 'flex';
  document.querySelectorAll('.role-btn').forEach(btn => btn.disabled = true);

  setTimeout(() => {
    window.location.href = "map.html";
  }, 2000);

  });


