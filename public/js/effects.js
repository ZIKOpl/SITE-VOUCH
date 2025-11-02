document.body.addEventListener('click', () => {
  document.body.classList.add('clicking');
  setTimeout(() => document.body.classList.remove('clicking'), 300);
});

const cursor = document.createElement('div');
cursor.classList.add('cursor-light');
document.body.appendChild(cursor);
document.addEventListener('mousemove', e => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
});
