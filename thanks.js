(() => {
  const button = document.querySelector('[data-thanks-character]');
  const message = document.querySelector('[data-thanks-message]');
  const lines = [
    '谢谢你，把球球放在心上。',
    '你的想法，让球球更好一点。',
    '这份鼓励，春野认真收下啦。',
    '有你在，小小陪伴也有力量。',
    '谢谢你，让球球的故事继续。',
    '今天的好心情，也分你一份。',
    '谢谢你，球球收到啦。',
    '你的心意，认真收好啦。',
    '你的小建议，有大作用。',
    '这点进步，也有你的功劳。',
    '你的喜欢，是今天的好消息。',
    '这份支持，能开心很久。',
    '谢谢你，让今天亮了一点。',
    '球球记住啦，春野也记住啦。',
    '把这句谢谢，放在你桌边。',
    '有你鼓励，创作更有劲啦。',
    '小小的问题，谢谢你发现。',
    '认真听见，慢慢变好。',
    '谢谢你，把日常变可爱。',
    '你的心意，收进故事里啦。',
    '隔着屏幕，也想说谢谢。',
    '谢谢你，让小想法有回响。',
    '送你一个球球抱抱。',
    '下次变好，还想请你来看看。'
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
