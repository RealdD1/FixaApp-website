export function getCurrentUser() {
  const user = JSON.parse(localStorage.getItem('user'));
  const token = localStorage.getItem('token');

  if (!user || !token) {
    window.location = 'SignIn.html';
    return null;
  }

  user._id = user._id || user.id;
  return { user, token };
}