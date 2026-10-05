const pages = document.querySelectorAll('.onboarding-page');
const nextBtns = document.querySelectorAll('.next-btn');
const prevBtns = document.querySelectorAll('.prev-btn');
const skipBtns = document.querySelectorAll('.skip-btn');
const getStartedBtn = document.querySelector('.get-started-btn');

let currentPage = 0;

function showPage(newIndex) {
  pages.forEach((page, index) => {
    page.classList.remove('active', 'prev');

    if (index === newIndex) {
      page.classList.add('active');
    } else if (index < newIndex) {
      page.classList.add('prev');
    }
  });
}

nextBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (currentPage < pages.length - 1) {
      currentPage++;
      showPage(currentPage);
    }
  });
});

prevBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      showPage(currentPage);
    }
  });
});

skipBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentPage = pages.length - 1;
    showPage(currentPage);
  });
});

getStartedBtn.addEventListener('click', () => {
  window.location.href = 'Signup.html'; // Or your next page
});