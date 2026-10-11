(() => {
  const button = document.querySelector('[data-thanks-character]');
  const message = document.querySelector('[data-thanks-message]');
  const lines = [
    '谢谢你，把小小的球球放在心上。',
    '你的每个想法，都让球球更好一点。',
    '这份鼓励，春野认真收下啦。',
    '有你在，小小的陪伴也有了力量。',
    '谢谢你，让球球的故事继续。',
    '今天的好心情，也分你一份。'
  ];
  let timer;
  button.addEventListener('click', () => {
    const options = lines.filter(line => line !== message.textContent);
    message.textContent = options[Math.floor(Math.random() * options.length)];
    message.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { message.hidden = true; }, 4200);
  });
})();
