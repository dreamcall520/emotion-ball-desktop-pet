(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const login = $('login'), dashboard = $('dashboard'), records = $('records'), password = $('password');
  const preview = $('preview'), urls = new Set();
  const types = { problem:'遇到问题', suggestion:'使用建议', feature:'想要的功能' };
  const sources = { website:'官网', app:'App' };
  let cursor = null, count = 0, generation = 0, loading = false, controller = new AbortController();
  const status = (id, text = '', error = false) => { $(id).textContent = text; $(id).dataset.error = String(error); };
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const closePreview = () => { preview.close(); $('preview-image').removeAttribute('src'); $('preview-image').alt = ''; $('download').removeAttribute('href'); $('download').removeAttribute('download'); $('preview-title').textContent = '截图预览'; };
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { observer.unobserve(entry.target); entry.target.loadImage(); }
  }), { rootMargin:'200px' });
  function clearRecords() {
    generation++;
    controller.abort();
    controller = new AbortController();
    observer.disconnect();
    closePreview();
    records.replaceChildren();
    urls.forEach(url => URL.revokeObjectURL(url));
    urls.clear();
    cursor = null;
    count = 0;
    loading = false;
    $('summary').textContent = '按提交时间由新到旧';
    $('load-more').hidden = true;
    $('refresh').disabled = false;
  }
  function showLogin(message = '', error = false) {
    clearRecords();
    login.hidden = false;
    dashboard.hidden = true;
    $('logout').hidden = true;
    password.value = '';
    status('list-status');
    status('login-status', message, error);
  }
  const errorText = error => ({ 403:'当前操作被拒绝，请刷新页面后重试。', 429:'操作太频繁，请稍后再试。', 503:'服务暂时不可用，请稍后重试。', 404:'这张截图暂时无法找到。' }[error.status] || '暂时无法连接，请检查网络后重试。');
  async function request(path, options = {}) {
    const current = generation;
    const response = await fetch(path, { ...options, credentials:'same-origin', cache:'no-store', signal:controller.signal });
    if (current !== generation) throw new DOMException('页面已更新', 'AbortError');
    if (!response.ok) { const error = new Error(); error.status = response.status; throw error; }
    return response;
  }
  function handleError(error, id, initial = false) {
    if (error.name === 'AbortError') return;
    if (error.status === 401) showLogin(initial ? '' : '登录已过期，请重新输入管理密码。');
    else status(id, errorText(error), true);
  }
  function attachmentButton(item, attachment) {
    const button = node('button', null, 'attachment');
    button.type = 'button';
    button.setAttribute('aria-label', `查看截图：${attachment.name}`);
    const thumbnail = node('span', '加载截图…', 'thumbnail');
    button.append(thumbnail, node('span', attachment.name, 'filename'));
    let imageUrl = null, pending = null;
    const current = generation;
    button.loadImage = () => {
      if (pending || imageUrl || current !== generation) return pending;
      pending = (async () => {
        try {
          const response = await request(`/api/admin/feedback/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(attachment.filename)}`);
          const blob = await response.blob();
          if (current !== generation) return;
          if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) throw new Error('无法预览');
          imageUrl = URL.createObjectURL(blob);
          urls.add(imageUrl);
          const image = node('img');
          image.src = imageUrl;
          image.alt = '';
          thumbnail.replaceChildren(image);
        } catch (error) {
          if (current !== generation || error.name === 'AbortError') return;
          thumbnail.textContent = '点击重试';
          handleError(error, 'list-status');
        } finally { pending = null; }
      })();
      return pending;
    };
    button.addEventListener('click', async () => {
      await button.loadImage();
      if (!imageUrl || current !== generation) return;
      $('preview-title').textContent = attachment.name;
      $('preview-image').src = imageUrl;
      $('preview-image').alt = `反馈截图：${attachment.name}`;
      $('download').href = imageUrl;
      $('download').download = attachment.name;
      preview.showModal();
    });
    observer.observe(button);
    return button;
  }
  function render(item) {
    const article = node('article', null, 'record');
    const top = node('div', null, 'record-top');
    const time = node('time');
    time.dateTime = item.created_at;
    const date = new Date(item.created_at);
    time.textContent = Number.isNaN(date.getTime()) ? item.created_at : date.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    top.append(node('span', types[item.type] || '其他反馈', 'tag'), time);
    article.append(top, node('h2', item.title), node('p', item.detail, 'detail'));
    const metadata = node('dl');
    [['联系方式', item.contact], ['球球版本', item.version], ['系统版本', item.os], ['提交来源', sources[item.source] || item.source], ['反馈编号', item.id]].forEach(([label, value]) => {
      const field = node('div', null, label === '反馈编号' ? 'receipt' : '');
      field.append(node('dt', label), node('dd', value || '未填写'));
      metadata.append(field);
    });
    article.append(metadata);
    if (item.attachments?.length) {
      const attachments = node('div', null, 'attachments');
      attachments.setAttribute('aria-label', '截图附件');
      item.attachments.forEach(attachment => attachments.append(attachmentButton(item, attachment)));
      article.append(attachments);
    }
    return article;
  }
  async function loadFeedback(reset = false, initial = false) {
    if (loading) return;
    if (reset) clearRecords();
    const current = generation;
    loading = true;
    $('refresh').disabled = true;
    $('load-more').disabled = true;
    status('list-status', '正在加载反馈…');
    try {
      const result = await (await request(`/api/admin/feedback?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json();
      if (current !== generation) return;
      login.hidden = true;
      dashboard.hidden = false;
      $('logout').hidden = false;
      $('retry-logout').hidden = true;
      password.value = '';
      result.items.forEach(item => records.append(render(item)));
      count += result.items.length;
      cursor = result.nextCursor;
      $('summary').textContent = `已加载 ${count} 条 · 按提交时间由新到旧`;
      $('load-more').hidden = !cursor;
      status('list-status', count ? '' : '还没有收到反馈。用户提交后会显示在这里。');
    } catch (error) {
      handleError(error, login.hidden ? 'list-status' : 'login-status', initial);
    } finally {
      if (current === generation) { loading = false; $('refresh').disabled = false; $('load-more').disabled = false; }
    }
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    clearRecords();
    $('login-button').disabled = true;
    status('login-status', '正在登录…');
    const body = JSON.stringify({ password:password.value });
    password.value = '';
    try {
      await request('/api/admin/session', { method:'POST', headers:{ 'Content-Type':'application/json' }, body });
      await loadFeedback(true);
    } catch (error) {
      if (error.status === 401) status('login-status', '管理密码不正确，请重新输入。', true);
      else handleError(error, 'login-status');
    } finally { $('login-button').disabled = false; }
  });
  async function logout() {
    showLogin('正在退出…');
    $('retry-logout').hidden = true;
    $('login-button').disabled = true;
    try {
      const response = await request('/api/admin/logout', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
      if (response.status !== 200) throw new Error('退出未完成');
      status('login-status', '已退出，请输入管理密码重新登录。');
    } catch (error) {
      if (error.name !== 'AbortError') { status('login-status', '退出未完成，请恢复网络后重试。', true); $('retry-logout').hidden = false; }
    } finally { $('login-button').disabled = false; }
  }
  $('logout').addEventListener('click', logout);
  $('retry-logout').addEventListener('click', logout);
  $('refresh').addEventListener('click', () => loadFeedback(true));
  $('load-more').addEventListener('click', () => loadFeedback());
  $('close-preview').addEventListener('click', closePreview);
  preview.addEventListener('cancel', closePreview);
  window.addEventListener('pagehide', () => showLogin());
  window.addEventListener('pageshow', event => { if (event.persisted) loadFeedback(true, true); });
  loadFeedback(true, true);
})();
