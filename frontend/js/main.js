import { logout } from "./auth.js";

// =====================
// Page toggles
// =====================
function showRegister() {
  hideAll();
  document.getElementById('registerPage').style.display = 'grid';
}

function showLogin() {
  hideAll();
  document.getElementById('loginPage').style.display = 'grid';
}

function showHomepage() {
  hideAll();
  document.getElementById('homepage').style.display = 'block';
}

function showUploadPage() {
  hideAll();
  document.getElementById('uploadPage').style.display = 'flex';
}

function showResultPage() {
  hideAll();
  document.getElementById('resultPage').style.display = 'block';
}

function hideAll() {
  ['registerPage','loginPage','homepage','uploadPage','resultPage']
    .forEach(id => document.getElementById(id).style.display = 'none');
}

showRegister();

// =====================
// Search filter
// =====================
window.searchFile = function() {
  const input = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('.file-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(input) ? 'block' : 'none';
  });
}

// =====================
// Sidebar collapse + floating dots toggle
// =====================
const sidebar = document.getElementById('sidebar');
const container = document.getElementById('container');
const collapseSidebar = document.getElementById('collapseSidebar');
const floatingDots = document.getElementById('floatingDots');

collapseSidebar.addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  container.style.gridTemplateColumns = '0 1fr';
  setTimeout(() => floatingDots.classList.add('visible'), 350);
});

floatingDots.addEventListener('click', () => {
  floatingDots.classList.remove('visible');
  sidebar.classList.remove('collapsed');
  container.style.gridTemplateColumns = '260px 1fr';
});

//Logout
const userBtn = document.querySelector(".icon-btn.icon-person");
const userMenu = document.getElementById("userMenu");
const logoutBtn = document.getElementById("logoutBtn");

// Toggle menu when clicking person icon
userBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userMenu.style.display = 
        userMenu.style.display === "block" ? "none" : "block";
});

// Hide menu when clicking outside
document.addEventListener("click", () => {
    userMenu.style.display = "none";
});

// Logout action
logoutBtn.addEventListener("click", () => {
    userMenu.style.display = "none";
  logout();
});

// =====================
// Cosmetic progress animation
// =====================
(function(){
  setInterval(() => {
    const played = document.querySelector('.played');
    if(played){
      let w = parseFloat(played.style.width) || 40;
      w += 0.15; 
      if(w > 100) w = 40;
      played.style.width = w + '%';
    }
  }, 100);
})();

// =====================
// Expose functions globally for inline onclicks
// =====================
window.showRegister = showRegister;
window.showLogin = showLogin;
window.showHomepage = showHomepage;
window.showUploadPage = showUploadPage;
window.showResultPage = showResultPage;
